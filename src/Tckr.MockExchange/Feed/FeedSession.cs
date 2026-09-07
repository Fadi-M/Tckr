using System.Buffers;
using System.IO.Pipelines;
using System.Net.Sockets;
using Microsoft.Extensions.Logging;
using Tckr.MockExchange.Protocol;

namespace Tckr.MockExchange.Feed;

/// <summary>
/// One accepted consumer: its identity, its own sequence numbering, its bounded outbound buffer,
/// and the loop that drains that buffer into the socket.
/// </summary>
/// <remarks>
/// The whole design turns on one rule: <see cref="TryPublish"/> is called from the generation
/// thread and must never wait for the network. It encodes into the session's
/// <see cref="PipeWriter"/> and flushes; while the pipe holds less than
/// <see cref="FeedServerOptions.SessionBufferBytes"/> that flush completes synchronously and the
/// call costs an encode and nothing else. When the pipe is full the flush comes back incomplete,
/// and instead of awaiting it &#8212; which is exactly how a slow consumer takes the exchange down
/// with it &#8212; the session marks itself behind, hands the pending flush to a background
/// handler, and returns. From that moment the publisher skips this session on a single volatile
/// read until the handler has resolved it one way or the other.
/// <para>
/// Sequence numbers belong to the session and are consumed by every record the session is
/// <em>offered</em>, not by every record it is sent. A record withheld while the session is behind
/// burns its number, so what the consumer eventually sees is a gap exactly the size of what it
/// lost. The alternative &#8212; numbering only what survives &#8212; produces a contiguous stream
/// that is quietly missing a slice of the tape, which is the one failure mode a sequenced feed
/// exists to rule out.
/// <para>
/// There is exactly one writer to the pipe (whoever calls <see cref="TryPublish"/>, serialised
/// with the session-start write and with shutdown by <see cref="_writeGate"/>) and exactly one
/// reader (<see cref="RunWriteLoopAsync"/>), which is the concurrency shape
/// <c>System.IO.Pipelines</c> is built for. Heartbeats deliberately bypass the pipe and go
/// straight to the socket: they are only ever emitted from the read loop at a moment when the pipe
/// has just been observed empty, so ordering is preserved without adding a second writer &#8212;
/// and therefore lock contention &#8212; to the publish path.
/// </para>
/// </remarks>
internal sealed class FeedSession : IAsyncDisposable
{
    /// <summary>Close reasons. Stable, low-cardinality strings: they are metric tags and log properties.</summary>
    internal static class Reasons
    {
        /// <summary>Still behind after the slow-consumer timeout.</summary>
        internal const string SlowConsumer = "slow-consumer";

        /// <summary>Drained, but records were withheld while it was stuck, and this policy promises a complete tape.</summary>
        internal const string SlowConsumerLoss = "slow-consumer-loss";

        /// <summary>The peer shut the connection down.</summary>
        internal const string ClientClosed = "client-closed";

        /// <summary>The peer vanished: reset, or an I/O error on the socket.</summary>
        internal const string ClientReset = "client-reset";

        /// <summary>Encoding or the pipe itself failed. Contained to this session.</summary>
        internal const string WriteFailed = "write-failed";

        /// <summary>The exchange is shutting down.</summary>
        internal const string ServerShutdown = "server-shutdown";
    }

    private const int StateRunning = 0;
    private const int StateBackpressured = 1;
    private const int StateClosing = 2;

    private readonly Socket _socket;
    private readonly FeedServerOptions _options;
    private readonly ILogger _logger;
    private readonly IFeedServerMetrics _metrics;
    private readonly TimeProvider _timeProvider;
    private readonly Action<FeedSession, string> _onClosed;

    private readonly PipeWriter _writer;
    private readonly PipeReader _reader;
    private readonly CancellationTokenSource _cts = new();

    /// <summary>Serialises everything that touches <see cref="_writer"/>. Uncontended on the publish path.</summary>
    private readonly Lock _writeGate = new();

    private readonly ITimer _heartbeatTimer;
    private readonly TimeSpan _heartbeatInterval;
    private readonly TimeSpan _slowConsumerTimeout;
    private readonly byte[] _heartbeatScratch = new byte[FeedFrameWriter.HeartbeatFrameSize];

    private Task _writeLoop = Task.CompletedTask;
    private Task _receiveLoop = Task.CompletedTask;

    private ulong _nextSequence = 1;
    private ulong _lastSequenceQueued;
    private int _state = StateRunning;
    private int _started;
    private int _closeRequested;
    private int _finished;
    private int _discardRequested;
    private long _skippedRecords;
    private long _discardedRecords;
    private long _skippedAtOnset;
    private long _discardedAtOnset;
    private long _bytesWritten;
    private string _closeReason = Reasons.ClientClosed;

    internal FeedSession(
        Socket socket,
        FeedServerOptions options,
        ILogger logger,
        IFeedServerMetrics metrics,
        TimeProvider timeProvider,
        Action<FeedSession, string> onClosed)
    {
        _socket = socket;
        _options = options;
        _logger = logger;
        _metrics = metrics;
        _timeProvider = timeProvider;
        _onClosed = onClosed;

        SessionId = Guid.NewGuid();
        RemoteEndPoint = SafeRemoteEndPoint(socket);

        _heartbeatInterval = TimeSpan.FromMilliseconds(options.HeartbeatIntervalMs);
        _slowConsumerTimeout = TimeSpan.FromMilliseconds(options.SlowConsumerTimeoutMs);

        // The reader and writer schedulers are left at their defaults, which is
        // PipeScheduler.ThreadPool. That is load-bearing rather than incidental: an inline reader
        // scheduler would run the socket send on whichever thread called Publish, which is
        // precisely the coupling this class exists to prevent.
        Pipe pipe = new(new PipeOptions(
            pauseWriterThreshold: options.SessionBufferBytes,
            resumeWriterThreshold: options.SessionBufferBytes / 2,
            useSynchronizationContext: false));

        _writer = pipe.Writer;
        _reader = pipe.Reader;

        _heartbeatTimer = timeProvider.CreateTimer(
            static state => ((FeedSession)state!).OnHeartbeatDue(),
            this,
            Timeout.InfiniteTimeSpan,
            Timeout.InfiniteTimeSpan);
    }

    /// <summary>Identity of this connection, assigned on accept and carried in the session-start frame.</summary>
    internal Guid SessionId { get; }

    /// <summary>The peer, for logs. Captured on accept because it is unavailable once the socket closes.</summary>
    internal string RemoteEndPoint { get; }

    /// <summary>Why the session ended. Meaningful once the write loop has finished.</summary>
    internal string CloseReason => Volatile.Read(ref _closeReason);

    /// <summary>Payload bytes handed to this session's socket so far.</summary>
    internal long BytesWritten => Interlocked.Read(ref _bytesWritten);

    /// <summary>Records this session never received because it was behind.</summary>
    internal long DroppedRecords => Interlocked.Read(ref _skippedRecords) + Interlocked.Read(ref _discardedRecords);

    /// <summary>
    /// Writes the session-start frame and starts the loops.
    /// </summary>
    /// <remarks>
    /// The session is already in the publish roster by the time this runs &#8212; it has to be, or a
    /// connection that dies during start-up would leak its slot &#8212; so ordering of the first
    /// frame is enforced here instead: <see cref="TryPublish"/> refuses everything until
    /// <see cref="_started"/> is set, and that is set under the same lock that writes the
    /// session-start frame. A tick therefore cannot overtake it.
    /// </remarks>
    internal void Start()
    {
        long startNanos = UtcNowNanos();

        lock (_writeGate)
        {
            Span<byte> span = _writer.GetSpan(FeedFrameWriter.SessionStartFrameSize);
            int written = FeedFrameWriter.WriteSessionStart(
                span, SessionId, (uint)_options.HeartbeatIntervalMs, startNanos);
            _writer.Advance(written);

            // Thirty-six bytes into an empty pipe: this flush completes synchronously. The
            // ValueTask is observed rather than awaited so Start() can stay non-async and finish
            // before the session is visible to Publish.
            ValueTask<FlushResult> flush = _writer.FlushAsync(_cts.Token);
            if (flush.IsCompleted)
            {
                flush.GetAwaiter().GetResult();
            }
            else
            {
                ObserveAbandoned(flush.AsTask());
            }

            Volatile.Write(ref _started, 1);
        }

        _writeLoop = Task.Run(RunWriteLoopAsync);
        _receiveLoop = Task.Run(RunReceiveLoopAsync);
    }

    /// <summary>
    /// Encodes <paramref name="batch"/> for this session and queues it. Never waits on the socket.
    /// </summary>
    /// <returns>
    /// <see langword="true"/> if the batch was queued; <see langword="false"/> if the session is
    /// behind or closing, in which case the records are counted as dropped for this session.
    /// </returns>
    /// <remarks>
    /// Records refused here still consume their sequence numbers. That is the point: the gap the
    /// consumer eventually sees is exactly the size of what was withheld, which makes exchange-side
    /// loss as visible as network loss instead of hiding it behind a contiguous stream.
    /// </remarks>
    internal bool TryPublish(ReadOnlySpan<FeedRecord> batch)
    {
        if (batch.IsEmpty)
        {
            return false;
        }

        // Not yet handshaken. Not counted as a drop: nothing has been promised to this consumer
        // until its session-start frame is on the wire.
        if (Volatile.Read(ref _started) == 0)
        {
            return false;
        }

        // Unsynchronised fast-out: a session that is behind or closing costs the publisher one
        // volatile read and nothing else.
        int state = Volatile.Read(ref _state);
        if (state != StateRunning)
        {
            Skip(state, batch.Length);
            return false;
        }

        bool queued;
        bool faulted = false;

        lock (_writeGate)
        {
            state = Volatile.Read(ref _state);
            if (state != StateRunning)
            {
                Skip(state, batch.Length);
                return false;
            }

            try
            {
                queued = WriteBatchLocked(batch);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(
                    ex, "Feed session {SessionId} failed while encoding a batch; closing it.", SessionId);

                MarkClosingLocked(Reasons.WriteFailed);
                queued = false;
                faulted = true;
            }
        }

        if (faulted && BeginClose(Reasons.WriteFailed))
        {
            Teardown();
        }

        return queued;
    }

    /// <summary>
    /// Stops the session gracefully: refuse further batches, drain what is already queued within
    /// <paramref name="timeout"/>, then close.
    /// </summary>
    internal async Task StopAsync(TimeSpan timeout)
    {
        BeginClose(Reasons.ServerShutdown);

        try
        {
            await _writeLoop.WaitAsync(timeout).ConfigureAwait(false);
        }
        catch (TimeoutException)
        {
            _logger.LogWarning(
                "Feed session {SessionId} did not flush within {TimeoutMs} ms; closing it hard.",
                SessionId,
                (int)timeout.TotalMilliseconds);
        }
        catch (Exception)
        {
            // The write loop logs and records its own failures.
        }

        Teardown();
        await AwaitLoopsAsync().ConfigureAwait(false);
    }

    public async ValueTask DisposeAsync()
    {
        BeginClose(CloseReason);
        Teardown();
        await AwaitLoopsAsync().ConfigureAwait(false);

        _heartbeatTimer.Dispose();
        _cts.Dispose();
    }

    // ---- publish path -------------------------------------------------------------------

    /// <summary>
    /// Accounts for a batch the session could not take.
    /// </summary>
    /// <remarks>
    /// A session that is merely behind still owns its place in the tape, so the records it misses
    /// consume their sequence numbers and the consumer sees the hole. A session that is closing
    /// owns nothing any more: its stream has ended, and burning numbers into a stream nobody will
    /// read would only inflate the drop count with records that were never going anywhere.
    /// </remarks>
    private void Skip(int state, int count)
    {
        if (state != StateBackpressured)
        {
            return;
        }

        Interlocked.Add(ref _nextSequence, (ulong)count);
        Interlocked.Add(ref _skippedRecords, count);

        // Reported here rather than when the backpressure episode resolves. Counting at the point
        // of loss means no increment can be stranded by the bookkeeping around an episode
        // boundary, and it keeps the invariant a consumer can check: the gap it sees is exactly
        // the number the exchange admitted to.
        _metrics.RecordsDropped(SessionId, count);
    }

    private bool WriteBatchLocked(ReadOnlySpan<FeedRecord> batch)
    {
        int needed = batch.Length * FeedFrameWriter.TickFrameSize;

        // Encoded straight into the pipe's own memory: no intermediate buffer, no copy, nothing to
        // rent or return. See the encode-strategy note in the task 05 brief for why this beats
        // encoding once into a scratch buffer and patching per-session sequence numbers into it.
        Span<byte> span = _writer.GetSpan(needed);

        // Reserved atomically, because a concurrent skip on another thread consumes numbers from
        // the same counter. Writes themselves are serialised by the lock.
        ulong count = (ulong)batch.Length;
        ulong first = Interlocked.Add(ref _nextSequence, count) - count;

        ulong sequence = first;
        int offset = 0;

        for (int i = 0; i < batch.Length; i++)
        {
            offset += FeedFrameWriter.WriteTick(span[offset..], batch[i] with { SequenceNumber = sequence });
            sequence++;
        }

        _writer.Advance(offset);

        // The last sequence number actually written, which is what a heartbeat reports. It is
        // deliberately not the last number handed out: see SendHeartbeatAsync.
        Volatile.Write(ref _lastSequenceQueued, sequence - 1);

        ValueTask<FlushResult> flush = _writer.FlushAsync(_cts.Token);

        if (flush.IsCompleted)
        {
            FlushResult result = flush.GetAwaiter().GetResult();
            if (result.IsCompleted || result.IsCanceled)
            {
                MarkClosingLocked(Reasons.ClientReset);
            }

            return true;
        }

        // The pipe is paused: this consumer is behind. The pending flush must not be awaited on
        // this thread, and the writer must not be touched again until it resolves, so the session
        // stops accepting batches and a background handler applies the policy.
        Volatile.Write(ref _skippedAtOnset, Interlocked.Read(ref _skippedRecords));
        Volatile.Write(ref _discardedAtOnset, Interlocked.Read(ref _discardedRecords));
        Volatile.Write(ref _state, StateBackpressured);

        _logger.LogWarning(
            "Feed session {SessionId} at {RemoteEndPoint} is behind: its {BufferBytes}-byte outbound buffer "
            + "is full. Applying {Policy} if it has not drained within {TimeoutMs} ms.",
            SessionId,
            RemoteEndPoint,
            _options.SessionBufferBytes,
            _options.SlowConsumerPolicy,
            _options.SlowConsumerTimeoutMs);

        _ = HandleBackpressureAsync(flush);
        return true;
    }

    /// <summary>
    /// Resolves a paused pipe. Started from the publish path but never awaited by it; its first
    /// action is an await on an incomplete task, so it yields before the publish lock is released.
    /// </summary>
    private async Task HandleBackpressureAsync(ValueTask<FlushResult> flush)
    {
        bool dropOldest = _options.SlowConsumerPolicy == SlowConsumerPolicy.DropOldest;

        if (dropOldest)
        {
            // Tell the read loop to throw away everything it has buffered. That is what makes this
            // policy "drop oldest" rather than "drop whatever happened to arrive while we were
            // stuck": the bytes discarded are the ones that have been waiting longest.
            Volatile.Write(ref _discardRequested, 1);
            TryCancelPendingRead();
        }

        Task<FlushResult> flushTask = flush.AsTask();
        string? disconnectReason = null;

        try
        {
            using CancellationTokenSource delayCts = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token);
            Task delay = Task.Delay(_slowConsumerTimeout, _timeProvider, delayCts.Token);

            Task completed = await Task.WhenAny(flushTask, delay).ConfigureAwait(false);

            delayCts.Cancel();
            ObserveAbandoned(delay);

            if (!ReferenceEquals(completed, flushTask))
            {
                // Never drained. Whatever the policy, a socket that has not accepted a single byte
                // for the whole timeout cannot be rescued by freeing buffer space on our side.
                ObserveAbandoned(flushTask);
                DisconnectSlow(Reasons.SlowConsumer);
                return;
            }

            FlushResult result = await flushTask.ConfigureAwait(false);

            if (result.IsCompleted || result.IsCanceled)
            {
                // The reader side is gone, or shutdown cancelled the flush. Either way this is not
                // a slow-consumer event and the reason has already been recorded.
                MarkClosing(Reasons.ClientReset);
                return;
            }
        }
        catch (OperationCanceledException)
        {
            ObserveAbandoned(flushTask);
            return;
        }
        catch (Exception ex)
        {
            ObserveAbandoned(flushTask);
            _logger.LogWarning(ex, "Feed session {SessionId} failed while recovering from backpressure.", SessionId);

            if (BeginClose(Reasons.WriteFailed))
            {
                Teardown();
            }

            return;
        }

        // The request is only good for the episode that raised it. If the drain loop emptied the
        // pipe by sending rather than by discarding, a flag left set here would throw away frames
        // published after the session had already recovered.
        Volatile.Write(ref _discardRequested, 0);

        lock (_writeGate)
        {
            if (Volatile.Read(ref _state) != StateBackpressured)
            {
                return;
            }

            long skipped = Interlocked.Read(ref _skippedRecords) - Volatile.Read(ref _skippedAtOnset);
            long discarded = Interlocked.Read(ref _discardedRecords) - Volatile.Read(ref _discardedAtOnset);
            long lost = skipped + discarded;

            if (!dropOldest && skipped > 0)
            {
                // It drained, but records were withheld while it was stuck. The consumer would see
                // the gap - that much is now guaranteed by the numbering - but this policy's
                // contract is a complete tape, and a session that has already lost records cannot
                // deliver one. Close it so the consumer reconnects onto a fresh, whole stream.
                _logger.LogWarning(
                    "Feed session {SessionId} drained but {DroppedRecords} records were withheld; disconnecting "
                    + "because {Policy} promises a complete tape.",
                    SessionId,
                    skipped,
                    _options.SlowConsumerPolicy);

                disconnectReason = Reasons.SlowConsumerLoss;
            }
            else if (lost > 0)
            {
                _logger.LogWarning(
                    "Feed session {SessionId} recovered under {Policy}; {DroppedRecords} records were dropped and "
                    + "the consumer will see a sequence gap.",
                    SessionId,
                    _options.SlowConsumerPolicy,
                    lost);

                Volatile.Write(ref _state, StateRunning);
            }
            else
            {
                _logger.LogInformation(
                    "Feed session {SessionId} recovered from backpressure with no loss.", SessionId);

                Volatile.Write(ref _state, StateRunning);
            }
        }

        if (disconnectReason is not null)
        {
            DisconnectSlow(disconnectReason);
        }
    }

    private void DisconnectSlow(string reason)
    {
        if (Volatile.Read(ref _closeRequested) != 0)
        {
            return;
        }

        _logger.LogWarning(
            "Feed session {SessionId} at {RemoteEndPoint} disconnected: {Reason}. It fell more than "
            + "{BufferBytes} bytes behind and did not recover within {TimeoutMs} ms.",
            SessionId,
            RemoteEndPoint,
            reason,
            _options.SessionBufferBytes,
            _options.SlowConsumerTimeoutMs);

        _metrics.SlowConsumerDisconnected(SessionId);

        if (BeginClose(reason))
        {
            Teardown();
        }
    }

    // ---- socket path --------------------------------------------------------------------

    private async Task RunWriteLoopAsync()
    {
        CancellationToken ct = _cts.Token;

        try
        {
            while (true)
            {
                ValueTask<ReadResult> pending = _reader.ReadAsync(ct);

                // The heartbeat timer is only armed when the pipe is genuinely empty. At the target
                // rate the read completes synchronously nearly every time and the timer is never
                // touched, which is also why heartbeats cannot appear while ticks are flowing.
                bool armed = !pending.IsCompleted && ArmHeartbeat();

                ReadResult read;
                try
                {
                    read = await pending.ConfigureAwait(false);
                }
                finally
                {
                    if (armed)
                    {
                        DisarmHeartbeat();
                    }
                }

                ReadOnlySequence<byte> buffer = read.Buffer;

                if (buffer.IsEmpty)
                {
                    if (read.IsCompleted)
                    {
                        break;
                    }

                    _reader.AdvanceTo(buffer.Start);

                    if (read.IsCanceled && Volatile.Read(ref _closeRequested) == 0)
                    {
                        await SendHeartbeatAsync(ct).ConfigureAwait(false);
                    }

                    continue;
                }

                if (Interlocked.Exchange(ref _discardRequested, 0) == 1)
                {
                    // Every frame in the pipe is a whole frame, and the send loop never leaves a
                    // partial one behind, so discarding the buffer wholesale drops whole records.
                    long discarded = buffer.Length / FeedFrameWriter.TickFrameSize;
                    Interlocked.Add(ref _discardedRecords, discarded);
                    _metrics.RecordsDropped(SessionId, discarded);
                    _reader.AdvanceTo(buffer.End);
                }
                else
                {
                    long length = buffer.Length;

                    foreach (ReadOnlyMemory<byte> segment in buffer)
                    {
                        await SendAllAsync(segment, ct).ConfigureAwait(false);
                    }

                    _reader.AdvanceTo(buffer.End);
                    Interlocked.Add(ref _bytesWritten, length);
                    _metrics.BytesWritten(SessionId, length);
                }

                if (read.IsCompleted)
                {
                    break;
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Shutdown, or a hard close applied by the slow-consumer policy. The reason is set there.
        }
        catch (Exception ex) when (ex is SocketException or IOException or ObjectDisposedException)
        {
            MarkClosing(Reasons.ClientReset);
            _logger.LogInformation(
                "Feed session {SessionId} at {RemoteEndPoint} ended: {Reason}.",
                SessionId,
                RemoteEndPoint,
                CloseReason);
        }
        catch (Exception ex)
        {
            // A faulted session must never reach FeedServer or any other session.
            MarkClosing(Reasons.WriteFailed);
            _logger.LogError(ex, "Feed session {SessionId} faulted in its write loop.", SessionId);
        }
        finally
        {
            Finish();
        }
    }

    /// <summary>
    /// Watches the inbound half purely to notice that the peer has gone. Consumers of this feed
    /// never send anything, so only EOF and errors matter &#8212; without this, a client that
    /// disappears while the market is quiet would sit in the roster until the next write failed.
    /// </summary>
    private async Task RunReceiveLoopAsync()
    {
        byte[] scratch = new byte[64];
        CancellationToken ct = _cts.Token;

        try
        {
            while (!ct.IsCancellationRequested)
            {
                int received = await _socket.ReceiveAsync(scratch, SocketFlags.None, ct).ConfigureAwait(false);
                if (received == 0)
                {
                    CloseFromPeer(Reasons.ClientClosed);
                    return;
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception)
        {
            CloseFromPeer(Reasons.ClientReset);
        }
    }

    private void CloseFromPeer(string reason)
    {
        if (BeginClose(reason))
        {
            _logger.LogInformation(
                "Feed session {SessionId} at {RemoteEndPoint} ended: {Reason}.",
                SessionId,
                RemoteEndPoint,
                reason);

            Teardown();
        }
    }

    private async ValueTask SendAllAsync(ReadOnlyMemory<byte> data, CancellationToken ct)
    {
        while (!data.IsEmpty)
        {
            int sent = await _socket.SendAsync(data, SocketFlags.None, ct).ConfigureAwait(false);
            if (sent <= 0)
            {
                throw new IOException("Socket send made no progress; the peer is gone.");
            }

            data = data[sent..];
        }
    }

    /// <summary>
    /// Emits a heartbeat carrying the last sequence number this session actually <em>wrote</em>.
    /// </summary>
    /// <remarks>
    /// Not the last number handed out, even though sequence numbers now count offered records. The
    /// heartbeat is the session's only positive delivery checkpoint: "everything up to N left this
    /// process", so a consumer holding less than N knows the shortfall was lost in transit rather
    /// than withheld here. Reporting the last <em>offered</em> number would fold exchange-side loss
    /// and network loss into one figure and destroy that distinction, and the protocol's own
    /// contract for the field &#8212; the last tick sent &#8212; is the written one.
    /// </remarks>
    private async ValueTask SendHeartbeatAsync(CancellationToken ct)
    {
        int written = FeedFrameWriter.WriteHeartbeat(
            _heartbeatScratch, Volatile.Read(ref _lastSequenceQueued), UtcNowNanos());

        await SendAllAsync(_heartbeatScratch.AsMemory(0, written), ct).ConfigureAwait(false);

        Interlocked.Add(ref _bytesWritten, written);
        _metrics.BytesWritten(SessionId, written);
    }

    private bool ArmHeartbeat()
    {
        if (_heartbeatInterval <= TimeSpan.Zero)
        {
            return false;
        }

        try
        {
            return _heartbeatTimer.Change(_heartbeatInterval, Timeout.InfiniteTimeSpan);
        }
        catch (ObjectDisposedException)
        {
            return false;
        }
    }

    private void DisarmHeartbeat()
    {
        try
        {
            _heartbeatTimer.Change(Timeout.InfiniteTimeSpan, Timeout.InfiniteTimeSpan);
        }
        catch (ObjectDisposedException)
        {
        }
    }

    private void OnHeartbeatDue() => TryCancelPendingRead();

    private void TryCancelPendingRead()
    {
        try
        {
            _reader.CancelPendingRead();
        }
        catch (Exception)
        {
            // The pipe is already finished; there is nothing to wake.
        }
    }

    // ---- lifecycle ----------------------------------------------------------------------

    /// <summary>
    /// Records the reason, stops accepting batches and completes the writer so the drain loop can
    /// finish. Does not touch the socket &#8212; that is <see cref="Teardown"/>, kept separate so a
    /// graceful stop can drain in between.
    /// </summary>
    /// <returns><see langword="true"/> if this call was the one that initiated the close.</returns>
    private bool BeginClose(string reason)
    {
        lock (_writeGate)
        {
            if (Interlocked.Exchange(ref _closeRequested, 1) != 0)
            {
                return false;
            }

            Volatile.Write(ref _closeReason, reason);
            Volatile.Write(ref _state, StateClosing);

            try
            {
                _writer.CancelPendingFlush();
                _writer.Complete();
            }
            catch (Exception)
            {
                // Already completed.
            }

            return true;
        }
    }

    /// <summary>Records a reason and stops accepting batches, without completing the writer.</summary>
    private void MarkClosing(string reason)
    {
        lock (_writeGate)
        {
            MarkClosingLocked(reason);
        }
    }

    private void MarkClosingLocked(string reason)
    {
        if (Volatile.Read(ref _closeRequested) == 0)
        {
            Volatile.Write(ref _closeReason, reason);
        }

        Volatile.Write(ref _state, StateClosing);
    }

    /// <summary>Cancels the loops and closes the socket. Idempotent.</summary>
    private void Teardown()
    {
        try
        {
            _cts.Cancel();
        }
        catch (ObjectDisposedException)
        {
        }

        CloseSocket();
    }

    private void CloseSocket()
    {
        try
        {
            _socket.Shutdown(SocketShutdown.Both);
        }
        catch (Exception)
        {
            // Already gone, or never got far enough to shut down.
        }

        try
        {
            _socket.Dispose();
        }
        catch (Exception)
        {
        }
    }

    private void Finish()
    {
        if (Interlocked.Exchange(ref _finished, 1) != 0)
        {
            return;
        }

        Volatile.Write(ref _state, StateClosing);

        try
        {
            _reader.Complete();
        }
        catch (Exception)
        {
        }

        try
        {
            _cts.Cancel();
        }
        catch (ObjectDisposedException)
        {
        }

        CloseSocket();
        DisarmHeartbeat();

        _onClosed(this, CloseReason);
    }

    private async Task AwaitLoopsAsync()
    {
        try
        {
            await _writeLoop.ConfigureAwait(false);
        }
        catch (Exception)
        {
            // The write loop logs its own failures; shutdown is not a place to rethrow them.
        }

        try
        {
            await _receiveLoop.ConfigureAwait(false);
        }
        catch (Exception)
        {
        }
    }

    private static void ObserveAbandoned(Task task) =>
        _ = task.ContinueWith(
            static t => _ = t.Exception,
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);

    private static string SafeRemoteEndPoint(Socket socket)
    {
        try
        {
            return socket.RemoteEndPoint?.ToString() ?? "unknown";
        }
        catch (Exception)
        {
            return "unknown";
        }
    }

    private long UtcNowNanos() =>
        (_timeProvider.GetUtcNow().UtcDateTime.Ticks - DateTime.UnixEpoch.Ticks) * 100L;
}
