using System.Net;
using System.Net.Sockets;
using Microsoft.Extensions.Logging;
using Tckr.MockExchange.Protocol;
using Tckr.MockExchange.Options;

namespace Tckr.MockExchange.Feed;

/// <summary>
/// Listens for TCP consumers, gives each one a session, and fans generated batches out to all of
/// them without ever waiting for any of them.
/// </summary>
/// <remarks>
/// <see cref="Publish"/> is the whole point of this class. It runs on the generation thread, and if
/// it can be made to wait &#8212; on a lock, on a socket, on a slow consumer's flush &#8212; then
/// the achieved rate of the mock exchange becomes a function of the slowest consumer attached to
/// it, and every Phase 4 measurement taken against it is measuring our write buffer rather than
/// ingestion. So the publish path holds no lock, awaits nothing, allocates nothing, and skips a
/// session that is behind on the strength of one volatile read.
/// <para>
/// The roster is an immutable array swapped under <see cref="_rosterGate"/> on accept and on
/// removal. Publish reads the reference once and iterates it; a session that disappears mid-batch
/// is written to harmlessly (its own state check refuses) and is simply absent from the next batch.
/// </para>
/// </remarks>
internal sealed class FeedServer : IAsyncDisposable
{
    private readonly FeedServerOptions _options;
    private readonly ILogger<FeedServer> _logger;
    private readonly IFeedServerMetrics _metrics;
    private readonly TimeProvider _timeProvider;

    private readonly Lock _rosterGate = new();
    private readonly CancellationTokenSource _shutdown = new();

    private Socket? _listener;
    private Task _acceptLoop = Task.CompletedTask;
    private int _admitted;
    private int _stopped;

    /// <summary>
    /// The publish roster. Read without synchronisation on the hot path and replaced wholesale
    /// under <see cref="_rosterGate"/>, so a publisher never blocks behind an accept or a close.
    /// </summary>
    private volatile FeedSession[] _sessions = [];

    internal FeedServer(
        FeedServerOptions options,
        ILogger<FeedServer> logger,
        IFeedServerMetrics? metrics = null,
        TimeProvider? timeProvider = null)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(logger);

        ArgumentOutOfRangeException.ThrowIfNegative(options.Port);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(options.Port, 65535);
        ArgumentOutOfRangeException.ThrowIfLessThan(options.MaxSessions, 1);
        ArgumentOutOfRangeException.ThrowIfLessThan(options.SessionBufferBytes, FeedFrameWriter.TickFrameSize * 2);
        ArgumentOutOfRangeException.ThrowIfLessThan(options.SlowConsumerTimeoutMs, 1);
        ArgumentOutOfRangeException.ThrowIfNegative(options.HeartbeatIntervalMs);
        ArgumentOutOfRangeException.ThrowIfLessThan(options.SendBufferSize, 1);
        ArgumentOutOfRangeException.ThrowIfNegative(options.ShutdownTimeoutMs);

        if (!IPAddress.TryParse(options.ListenAddress, out IPAddress? address))
        {
            throw new ArgumentException(
                $"'{options.ListenAddress}' is not an IP address. Use 0.0.0.0 for every interface.",
                nameof(options));
        }

        _options = options;
        _logger = logger;
        _metrics = metrics ?? NullFeedServerMetrics.Instance;
        _timeProvider = timeProvider ?? TimeProvider.System;
        BindAddress = address;
    }

    /// <summary>The address the listener binds to.</summary>
    internal IPAddress BindAddress { get; }

    /// <summary>
    /// The bound endpoint, available once <see cref="StartAsync"/> has returned. Meaningful when
    /// <see cref="FeedServerOptions.Port"/> is 0 and the OS picked the port, which is how the tests
    /// and the probe avoid fighting over a fixed one.
    /// </summary>
    internal IPEndPoint? LocalEndPoint { get; private set; }

    /// <summary>Sessions currently in the publish roster.</summary>
    internal int ActiveSessionCount => _sessions.Length;

    /// <summary>Binds the listener and starts accepting. Returns as soon as the socket is bound.</summary>
    internal Task StartAsync(CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _stopped) != 0, this);

        if (_listener is not null)
        {
            throw new InvalidOperationException("The feed server is already started.");
        }

        Socket listener = new(BindAddress.AddressFamily, SocketType.Stream, ProtocolType.Tcp);
        listener.Bind(new IPEndPoint(BindAddress, _options.Port));
        listener.Listen(Math.Max(16, _options.MaxSessions * 2));

        _listener = listener;
        LocalEndPoint = listener.LocalEndPoint as IPEndPoint;

        _logger.LogInformation(
            "Feed server listening on {LocalEndPoint} for up to {MaxSessions} sessions.",
            LocalEndPoint,
            _options.MaxSessions);

        _acceptLoop = Task.Run(() => RunAcceptLoopAsync(_shutdown.Token), CancellationToken.None);
        return Task.CompletedTask;
    }

    /// <summary>
    /// Fans <paramref name="batch"/> out to every session. Never blocks, never allocates, and never
    /// waits on a consumer.
    /// </summary>
    /// <returns>
    /// The number of sessions that took the batch. Sessions that are behind or closing are skipped
    /// and counted as dropped against themselves, so a return value below
    /// <see cref="ActiveSessionCount"/> means some consumer is in trouble.
    /// </returns>
    /// <remarks>
    /// Each session encodes the batch into its own pipe memory rather than sharing one encoded
    /// buffer, because sequence numbers are per session. That costs a full encode per session; see
    /// the task 05 brief for the measurement behind choosing it over encode-once-and-patch.
    /// </remarks>
    internal int Publish(ReadOnlySpan<FeedRecord> batch)
    {
        FeedSession[] sessions = _sessions;

        // Zero consumers is the normal case at start-up and after a disconnect. It must stay free:
        // generation runs at its configured rate whether or not anyone is listening.
        if (sessions.Length == 0 || batch.IsEmpty)
        {
            return 0;
        }

        int reached = 0;

        for (int i = 0; i < sessions.Length; i++)
        {
            if (sessions[i].TryPublish(batch))
            {
                reached++;
            }
        }

        return reached;
    }

    /// <summary>
    /// Stops accepting, gives every session <see cref="FeedServerOptions.ShutdownTimeoutMs"/> to
    /// flush what it already holds, then closes them.
    /// </summary>
    internal async Task StopAsync(CancellationToken ct)
    {
        if (Interlocked.Exchange(ref _stopped, 1) != 0)
        {
            return;
        }

        await _shutdown.CancelAsync().ConfigureAwait(false);

        try
        {
            _listener?.Close();
        }
        catch (Exception)
        {
            // Closing the listener is how the accept loop is woken; failures here are immaterial.
        }

        try
        {
            await _acceptLoop.ConfigureAwait(false);
        }
        catch (Exception)
        {
            // The accept loop logs its own failures.
        }

        FeedSession[] sessions;
        lock (_rosterGate)
        {
            sessions = _sessions;
            _sessions = [];
        }

        _logger.LogInformation(
            "Feed server stopping; draining {SessionCount} sessions within {TimeoutMs} ms.",
            sessions.Length,
            _options.ShutdownTimeoutMs);

        TimeSpan drain = TimeSpan.FromMilliseconds(_options.ShutdownTimeoutMs);
        Task[] stops = new Task[sessions.Length];

        for (int i = 0; i < sessions.Length; i++)
        {
            stops[i] = sessions[i].StopAsync(drain);
        }

        try
        {
            await Task.WhenAll(stops).WaitAsync(drain + TimeSpan.FromSeconds(1), ct).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is TimeoutException or OperationCanceledException)
        {
            _logger.LogWarning("Feed server shutdown exceeded its drain budget; sessions were closed hard.");
        }

        foreach (FeedSession session in sessions)
        {
            await session.DisposeAsync().ConfigureAwait(false);
        }

        _logger.LogInformation("Feed server stopped.");
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync(CancellationToken.None).ConfigureAwait(false);

        _listener?.Dispose();
        _shutdown.Dispose();
    }

    private async Task RunAcceptLoopAsync(CancellationToken ct)
    {
        Socket listener = _listener!;

        while (!ct.IsCancellationRequested)
        {
            Socket socket;

            try
            {
                socket = await listener.AcceptAsync(ct).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is OperationCanceledException or ObjectDisposedException)
            {
                break;
            }
            catch (SocketException ex)
            {
                if (ct.IsCancellationRequested)
                {
                    break;
                }

                _logger.LogWarning(ex, "Feed server failed to accept a connection.");
                continue;
            }

            Admit(socket);
        }
    }

    private void Admit(Socket socket)
    {
        string remote = socket.RemoteEndPoint?.ToString() ?? "unknown";

        if (Volatile.Read(ref _stopped) != 0)
        {
            Reject(socket, remote, "server-stopping");
            return;
        }

        // Counted rather than derived from the roster length so two simultaneous accepts cannot
        // both see room for the last slot.
        if (Interlocked.Increment(ref _admitted) > _options.MaxSessions)
        {
            Interlocked.Decrement(ref _admitted);
            Reject(socket, remote, "max-sessions");
            return;
        }

        FeedSession session;

        try
        {
            // NoDelay because this imitates a low-latency feed: we would rather pay a packet per
            // batch than let Nagle hold a 5 ms batch back waiting for company.
            socket.NoDelay = true;
            socket.SendBufferSize = _options.SendBufferSize;

            session = new FeedSession(
                socket, _options, _logger, _metrics, _timeProvider, OnSessionClosed);
        }
        catch (Exception ex)
        {
            Interlocked.Decrement(ref _admitted);
            _logger.LogWarning(ex, "Feed server could not set up a session for {RemoteEndPoint}.", remote);
            Reject(socket, remote, "setup-failed");
            return;
        }

        _logger.LogInformation(
            "Feed session {SessionId} accepted from {RemoteEndPoint}.", session.SessionId, remote);

        // Rostered before it is started, so that a session which dies during its own start-up still
        // runs through OnSessionClosed and gives its slot back. Ordering of the first frame is the
        // session's business: it refuses published batches until its session-start frame is written.
        lock (_rosterGate)
        {
            if (Volatile.Read(ref _stopped) != 0)
            {
                Interlocked.Decrement(ref _admitted);
                _ = session.DisposeAsync().AsTask();
                return;
            }

            _sessions = [.. _sessions, session];
        }

        _metrics.SessionAccepted(session.SessionId);

        try
        {
            session.Start();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                ex, "Feed session {SessionId} failed to start; dropping it.", session.SessionId);

            OnSessionClosed(session, FeedSession.Reasons.WriteFailed);
            _ = session.DisposeAsync().AsTask();
        }
    }

    private void Reject(Socket socket, string remote, string reason)
    {
        // Accepted and closed rather than left queued: a consumer that cannot be served should find
        // out immediately instead of waiting on a connection that will never carry a frame.
        _logger.LogWarning(
            "Rejected feed connection from {RemoteEndPoint}: {Reason}. {MaxSessions} sessions is the limit.",
            remote,
            reason,
            _options.MaxSessions);

        _metrics.SessionRejected(reason);

        try
        {
            socket.Shutdown(SocketShutdown.Both);
        }
        catch (Exception)
        {
        }

        try
        {
            socket.Dispose();
        }
        catch (Exception)
        {
        }
    }

    private void OnSessionClosed(FeedSession session, string reason)
    {
        bool removed = false;

        lock (_rosterGate)
        {
            FeedSession[] current = _sessions;
            int index = Array.IndexOf(current, session);

            if (index >= 0)
            {
                FeedSession[] next = new FeedSession[current.Length - 1];
                Array.Copy(current, next, index);
                Array.Copy(current, index + 1, next, index, current.Length - index - 1);
                _sessions = next;
                removed = true;
            }
        }

        if (removed)
        {
            Interlocked.Decrement(ref _admitted);
        }

        _metrics.SessionClosed(session.SessionId, reason);

        _logger.LogInformation(
            "Feed session {SessionId} closed: {Reason}. Sent {BytesWritten} bytes, dropped {DroppedRecords} records.",
            session.SessionId,
            reason,
            session.BytesWritten,
            session.DroppedRecords);
    }
}
