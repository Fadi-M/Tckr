using System.Buffers;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using Microsoft.Extensions.Logging.Testing;
using Tckr.MockExchange.Feed;
using Tckr.MockExchange.Options;
using Tckr.MockExchange.Protocol;

namespace Tckr.MockExchange.Tests.Feed;

/// <summary>
/// A live <see cref="FeedServer"/> on an ephemeral loopback port, with a fake logger and a
/// recording metrics sink attached.
/// </summary>
/// <remarks>
/// These tests are integration-flavoured on purpose. The behaviour under test &#8212; a slow
/// consumer must not slow the source &#8212; only exists at the point where a real socket stops
/// accepting bytes, so a mocked transport would test the mock. Binding port 0 keeps them
/// parallel-safe.
/// </remarks>
internal sealed class FeedTestHarness : IAsyncDisposable
{
    private readonly List<FeedTestClient> _clients = [];

    private FeedTestHarness(FeedServerOptions options, FakeLogger<FeedServer> logger, RecordingFeedMetrics metrics)
    {
        Options = options;
        Logger = logger;
        Metrics = metrics;
        Server = new FeedServer(options, logger, metrics);
    }

    internal FeedServerOptions Options { get; }

    internal FakeLogger<FeedServer> Logger { get; }

    internal RecordingFeedMetrics Metrics { get; }

    internal FeedServer Server { get; }

    internal IPEndPoint EndPoint => Server.LocalEndPoint
        ?? throw new InvalidOperationException("The server has not bound a port.");

    /// <summary>
    /// Starts a server. Defaults are deliberately small so a test can fill a session's buffer in
    /// milliseconds, and heartbeats are effectively off unless a test asks for them, so that a
    /// tick stream contains nothing but ticks.
    /// </summary>
    internal static async Task<FeedTestHarness> StartAsync(Action<FeedServerOptions>? configure = null)
    {
        FeedServerOptions options = new()
        {
            ListenAddress = "127.0.0.1",
            Port = 0,
            MaxSessions = 4,
            SessionBufferBytes = 128 * 1024,
            SlowConsumerTimeoutMs = 1000,
            HeartbeatIntervalMs = 60_000,
            SendBufferSize = 8 * 1024,
            ShutdownTimeoutMs = 2000,
        };

        configure?.Invoke(options);

        FeedTestHarness harness = new(options, new FakeLogger<FeedServer>(), new RecordingFeedMetrics());
        await harness.Server.StartAsync(CancellationToken.None);
        return harness;
    }

    /// <summary>
    /// Connects a consumer and reads its session-start frame, which is also the signal that the
    /// session is fully started and will accept published batches.
    /// </summary>
    /// <param name="receiveBufferSize">
    /// Small values keep the kernel from absorbing megabytes on behalf of a consumer that is
    /// pretending to be stuck.
    /// </param>
    internal async Task<FeedTestClient> ConnectAsync(int receiveBufferSize = 4096)
    {
        FeedTestClient client = await FeedTestClient.ConnectAsync(EndPoint, receiveBufferSize);
        _clients.Add(client);

        DecodedFrame frame = await client.ReadFrameAsync(TimeSpan.FromSeconds(5));
        frame.Type.ShouldBe(FeedMessageType.SessionStart);

        FeedFrameReader.ReadSessionStart(frame.Payload, out Guid sessionId, out uint heartbeatMs, out long startNanos);
        client.SessionId = sessionId;
        client.HeartbeatIntervalMs = heartbeatMs;
        client.SessionStartNanos = startNanos;

        return client;
    }

    /// <summary>Connects a consumer whose socket exists but which never drains a byte after the handshake.</summary>
    internal Task<FeedTestClient> ConnectStalledAsync() => ConnectAsync();

    internal static async Task WaitForAsync(Func<bool> condition, TimeSpan timeout, string what)
    {
        long deadline = Stopwatch.GetTimestamp() + (long)(timeout.TotalSeconds * Stopwatch.Frequency);

        while (Stopwatch.GetTimestamp() < deadline)
        {
            if (condition())
            {
                return;
            }

            await Task.Delay(5);
        }

        condition().ShouldBeTrue($"Timed out after {timeout.TotalMilliseconds} ms waiting for {what}.");
    }

    /// <summary>
    /// True if some log record carries a <c>Reason</c> property matching <paramref name="predicate"/>.
    /// Shouldly's predicate overloads take expression trees, which cannot hold patterns, so the
    /// matching happens here and the test asserts on a bool.
    /// </summary>
    internal bool HasLoggedReason(Func<string, bool> predicate) =>
        Logger.Collector.GetSnapshot().Any(record =>
            record.StructuredState is not null
            && record.StructuredState.Any(kv =>
                kv.Key == "Reason" && kv.Value is not null && predicate(kv.Value)));

    /// <summary>Log records at <see cref="Microsoft.Extensions.Logging.LogLevel.Error"/> or worse.</summary>
    internal IReadOnlyList<string> ErrorLogs =>
        [.. Logger.Collector.GetSnapshot()
            .Where(r => r.Level >= Microsoft.Extensions.Logging.LogLevel.Error)
            .Select(r => r.Message)];

    /// <summary>A batch of well-formed trade prints. Sequence numbers are assigned per session, not here.</summary>
    internal static FeedRecord[] MakeBatch(int count, string symbol = "COMI")
    {
        FeedRecord[] batch = new FeedRecord[count];
        Symbol8 packed = Symbol8.FromAscii(symbol);

        for (int i = 0; i < count; i++)
        {
            batch[i] = new FeedRecord
            {
                MessageType = FeedMessageType.Trade,
                Flags = 0,
                Quantity = (uint)(100 + i),
                SequenceNumber = 0,
                ExchangeTimestampNanos = 1_700_000_000_000_000_000L + i,
                PriceScaled = PriceScale.ToScaled(85.10m),
                Symbol = packed,
            };
        }

        return batch;
    }

    public async ValueTask DisposeAsync()
    {
        foreach (FeedTestClient client in _clients)
        {
            client.Dispose();
        }

        await Server.DisposeAsync();
    }
}

/// <summary>A decoded frame: its type and a copy of its payload.</summary>
internal readonly record struct DecodedFrame(FeedMessageType Type, byte[] Payload);

/// <summary>
/// A consumer of the feed, built on the real <see cref="FeedFrameReader"/> so the tests assert
/// against the wire rather than against an internal view of it.
/// </summary>
internal sealed class FeedTestClient : IDisposable
{
    private readonly TcpClient _client;
    private readonly NetworkStream _stream;

    private byte[] _buffer = new byte[64 * 1024];
    private int _start;
    private int _end;

    private FeedTestClient(TcpClient client)
    {
        _client = client;
        _stream = client.GetStream();
    }

    internal Guid SessionId { get; set; }

    internal uint HeartbeatIntervalMs { get; set; }

    internal long SessionStartNanos { get; set; }

    internal static async Task<FeedTestClient> ConnectAsync(IPEndPoint endPoint, int receiveBufferSize)
    {
        TcpClient client = new();
        client.ReceiveBufferSize = receiveBufferSize;
        client.NoDelay = true;

        await client.ConnectAsync(endPoint);
        return new FeedTestClient(client);
    }

    internal async Task<DecodedFrame> ReadFrameAsync(TimeSpan timeout)
    {
        using CancellationTokenSource cts = new(timeout);

        while (true)
        {
            ReadOnlySequence<byte> sequence = new(_buffer, _start, _end - _start);

            if (FeedFrameReader.TryReadFrame(ref sequence, out FeedMessageType type, out ReadOnlySequence<byte> payload))
            {
                byte[] bytes = payload.ToArray();
                _start = _end - (int)sequence.Length;
                return new DecodedFrame(type, bytes);
            }

            MakeRoom();

            int read = await _stream.ReadAsync(_buffer.AsMemory(_end), cts.Token);
            if (read == 0)
            {
                throw new EndOfStreamException("The feed closed the connection.");
            }

            _end += read;
        }
    }

    /// <summary>Reads the next <paramref name="count"/> tick frames, failing on anything else.</summary>
    internal async Task<List<FeedRecord>> ReadTicksAsync(int count, TimeSpan timeout)
    {
        List<FeedRecord> ticks = new(count);

        while (ticks.Count < count)
        {
            DecodedFrame frame = await ReadFrameAsync(timeout);
            frame.Type.ShouldBe(FeedMessageType.Trade);
            ticks.Add(FeedFrameReader.ReadTick(frame.Payload));
        }

        return ticks;
    }

    /// <summary>True once the peer has closed and the buffered bytes are exhausted.</summary>
    internal async Task<bool> IsClosedAsync(TimeSpan timeout)
    {
        try
        {
            while (true)
            {
                _ = await ReadFrameAsync(timeout);
            }
        }
        catch (EndOfStreamException)
        {
            return true;
        }
        catch (Exception ex) when (ex is IOException or SocketException or ObjectDisposedException)
        {
            return true;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }

    /// <summary>Kills the socket without a graceful shutdown, the way a crashed consumer would.</summary>
    internal void Kill()
    {
        _client.Client.LingerState = new LingerOption(true, 0);
        _client.Client.Close();
    }

    public void Dispose()
    {
        try
        {
            _stream.Dispose();
        }
        catch (Exception)
        {
        }

        try
        {
            _client.Dispose();
        }
        catch (Exception)
        {
        }
    }

    private void MakeRoom()
    {
        if (_end < _buffer.Length)
        {
            return;
        }

        if (_start > 0)
        {
            Buffer.BlockCopy(_buffer, _start, _buffer, 0, _end - _start);
            _end -= _start;
            _start = 0;
            return;
        }

        Array.Resize(ref _buffer, _buffer.Length * 2);
    }
}

/// <summary>Stands in for task 07's <c>FeedMetrics</c> and records what the server counted.</summary>
internal sealed class RecordingFeedMetrics : IFeedServerMetrics
{
    private readonly Lock _gate = new();

    internal int Accepted { get; private set; }

    internal int SlowConsumerDisconnects { get; private set; }

    internal long TotalBytesWritten { get; private set; }

    internal long TotalRecordsDropped { get; private set; }

    internal List<string> Rejections { get; } = [];

    internal List<(Guid SessionId, string Reason)> Closures { get; } = [];

    public void SessionAccepted(Guid sessionId)
    {
        lock (_gate)
        {
            Accepted++;
        }
    }

    public void SessionRejected(string reason)
    {
        lock (_gate)
        {
            Rejections.Add(reason);
        }
    }

    public void SessionClosed(Guid sessionId, string reason)
    {
        lock (_gate)
        {
            Closures.Add((sessionId, reason));
        }
    }

    public void SlowConsumerDisconnected(Guid sessionId)
    {
        lock (_gate)
        {
            SlowConsumerDisconnects++;
        }
    }

    public void RecordsDropped(Guid sessionId, long records)
    {
        lock (_gate)
        {
            TotalRecordsDropped += records;
        }
    }

    public void BytesWritten(Guid sessionId, long bytes)
    {
        lock (_gate)
        {
            TotalBytesWritten += bytes;
        }
    }

    internal IReadOnlyList<(Guid SessionId, string Reason)> ClosureSnapshot()
    {
        lock (_gate)
        {
            return [.. Closures];
        }
    }

    internal IReadOnlyList<string> RejectionSnapshot()
    {
        lock (_gate)
        {
            return [.. Rejections];
        }
    }
}
