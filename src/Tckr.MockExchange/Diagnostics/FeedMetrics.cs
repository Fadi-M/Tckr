using System.Diagnostics.Metrics;
using Tckr.MockExchange.Feed;
using Tckr.MockExchange.Session;

namespace Tckr.MockExchange.Diagnostics;

/// <summary>
/// Everything the mock exchange counts about itself, on one <see cref="System.Diagnostics.Metrics.Meter"/>.
/// </summary>
/// <remarks>
/// <para>
/// This exists so that a downstream result is readable. "Ingestion sustained 22,000/sec" is not a
/// measurement of ingestion unless the load source can say whether it offered 25,000 &#8212; and a
/// load source that reports its <em>configured</em> target rather than its <em>achieved</em> one
/// is asserting the thing under test. Every number here is achieved.
/// </para>
/// <para>
/// <b>Why <c>System.Diagnostics.Metrics</c> rather than a Prometheus client.</b> It is the
/// .NET-native instrument API, so Phase 14 can point an OTLP or Prometheus exporter at this meter
/// without touching a line of this file. The instrument names are dotted OpenTelemetry names; the
/// Prometheus exporter renders <c>mockexchange.events.generated</c> as
/// <c>mockexchange_events_generated_total</c>, which is the shape the master context's Phase 14
/// metric list is written in. Naming them now means the dashboards built later do not need
/// renaming.
/// </para>
/// <para>
/// <b>The hot-path rule.</b> <see cref="RecordBatch"/> is called once per batch &#8212; 200 times
/// a second at the default 5 ms batch &#8212; never once per event. At 25,000 events/sec the
/// difference is 24,800 instrument calls a second that buy no information a batch counter does not
/// already carry. There is an allocation test asserting the batch path stays at zero bytes.
/// </para>
/// <para>
/// <b>Cardinality.</b> Nothing is tagged with a symbol: 250 symbols across several instruments is
/// a time-series problem, and the tape's composition belongs in the benchmark report, not in a
/// live metric. Only the two genuinely per-consumer instruments &#8212;
/// <c>events.dropped</c> and <c>session.bytes_written</c> &#8212; carry <c>session.id</c>, because
/// "which consumer lost data" is a question a total cannot answer. Lifetime counters
/// (accepted, closed, slow-disconnected) do not: their session ids are unbounded over a long run,
/// and "which one" is already in the log line for that session. Counters say how many; logs say
/// which.
/// </para>
/// <para>
/// Thread-safe. The generation loop drives the batch methods, session threads drive the
/// <see cref="IFeedServerMetrics"/> ones, and the reporter reads the mirrors from a timer.
/// </para>
/// <para>
/// <b>No <c>/metrics</c> endpoint here.</b> The task brief offers a Prometheus scrape endpoint via
/// <c>OpenTelemetry.Exporter.Prometheus.HttpListener</c> if it costs nothing; it does not &#8212;
/// it is a package reference, a listener socket, a port to configure and a surface to secure, for
/// a job Phase 14 does once across every service. Everything an exporter needs is already here:
/// point one at the <c>Tckr.MockExchange</c> meter. // Phase 14
/// </para>
/// </remarks>
internal sealed class FeedMetrics : IFeedServerMetrics, IDisposable
{
    /// <summary>The meter name every instrument here belongs to.</summary>
    internal const string MeterName = "Tckr.MockExchange";

    /// <summary>Tag key identifying a consumer session.</summary>
    internal const string SessionIdTag = "session.id";

    /// <summary>Tag key carrying a stable, low-cardinality cause.</summary>
    internal const string ReasonTag = "reason";

    /// <summary>
    /// Pacing-lag samples retained for the reporter's percentile. At the default 5 ms batch this
    /// is roughly the last five seconds, which is one report interval; sized as a power of two so
    /// the write index masks instead of dividing.
    /// </summary>
    private const int LagSampleCapacity = 1024;

    private const int LagSampleMask = LagSampleCapacity - 1;

    private readonly Meter _meter;
    private readonly TimeProvider _timeProvider;
    private readonly RollingRateWindow _achieved;
    private readonly DateTimeOffset _startedAt;

    private readonly Counter<long> _eventsGenerated;
    private readonly Counter<long> _eventsPublished;
    private readonly Counter<long> _eventsDropped;
    private readonly Counter<long> _sessionsAccepted;
    private readonly Counter<long> _sessionsRejected;
    private readonly Counter<long> _sessionsClosed;
    private readonly Counter<long> _sessionsSlowDisconnected;
    private readonly Counter<long> _publishSessionsReached;
    private readonly Counter<long> _bytesWritten;
    private readonly Histogram<double> _pacingLag;
    private readonly Histogram<int> _batchSize;

    private readonly double[] _lagSamples = new double[LagSampleCapacity];

    private long _generatedTotal;
    private long _publishedTotal;
    private long _droppedTotal;
    private long _acceptedTotal;
    private long _rejectedTotal;
    private long _closedTotal;
    private long _slowDisconnectedTotal;
    private long _bytesWrittenTotal;
    private long _lagWrites;

    private double _targetRate;
    private volatile MarketPhase _phase;
    private Func<int> _activeSessions;

    /// <summary>Creates the meter and its instruments.</summary>
    /// <param name="timeProvider">
    /// Clock source for uptime and for the rolling achieved-rate window. Injected so both are
    /// testable against a virtual clock.
    /// </param>
    /// <param name="scope">
    /// Optional meter scope. Only tests pass one, so that a <c>MetricCollector</c> observes this
    /// instance's instruments rather than every <see cref="FeedMetrics"/> alive in the process.
    /// </param>
    /// <param name="achievedRateWindow">Span the achieved rate is averaged over. Defaults to five seconds.</param>
    internal FeedMetrics(
        TimeProvider? timeProvider = null,
        object? scope = null,
        TimeSpan? achievedRateWindow = null)
    {
        _timeProvider = timeProvider ?? TimeProvider.System;
        _startedAt = _timeProvider.GetUtcNow();
        _achieved = new RollingRateWindow(_timeProvider, achievedRateWindow);
        _meter = new Meter(MeterName, version: null, tags: null, scope: scope);

        // Until something authoritative is bound, the gauge answers from the accept/close ledger.
        // That is exact whenever the two are paired, which the feed server guarantees; the binding
        // exists so the guarantee does not have to be trusted.
        _activeSessions = SessionLedgerCount;

        _eventsGenerated = _meter.CreateCounter<long>(
            "mockexchange.events.generated", "events", "Records produced by the generator.");

        _eventsPublished = _meter.CreateCounter<long>(
            "mockexchange.events.published", "events", "Records handed to at least one session.");

        _eventsDropped = _meter.CreateCounter<long>(
            "mockexchange.events.dropped",
            "events",
            "Records a session was not given: refused while it was behind, or discarded from its buffer under DropOldest.");

        _sessionsAccepted = _meter.CreateCounter<long>(
            "mockexchange.sessions.accepted", "sessions", "Connections admitted, lifetime.");

        _sessionsRejected = _meter.CreateCounter<long>(
            "mockexchange.sessions.rejected", "sessions", "Connections refused before becoming a session.");

        _sessionsClosed = _meter.CreateCounter<long>(
            "mockexchange.sessions.closed", "sessions", "Sessions ended, by cause.");

        _sessionsSlowDisconnected = _meter.CreateCounter<long>(
            "mockexchange.sessions.slow_disconnected",
            "sessions",
            "Sessions killed by the slow-consumer policy. A subset of sessions.closed.");

        _publishSessionsReached = _meter.CreateCounter<long>(
            "mockexchange.publish.sessions_reached",
            "sessions",
            "Session-deliveries: summed over batches, how many sessions took each one.");

        _bytesWritten = _meter.CreateCounter<long>(
            "mockexchange.session.bytes_written", "bytes", "Payload bytes handed to a session's socket.");

        _pacingLag = _meter.CreateHistogram<double>(
            "mockexchange.pacing.lag", "ms", "How late a batch woke relative to its deadline.");

        _batchSize = _meter.CreateHistogram<int>(
            "mockexchange.batch.size", "events", "Events per generated batch.");

        _meter.CreateObservableGauge(
            "mockexchange.sessions.active", () => ActiveSessions, "sessions", "Consumers currently connected.");

        _meter.CreateObservableGauge(
            "mockexchange.rate.target", () => TargetEventsPerSecond, "events/s", "Rate currently being asked for.");

        _meter.CreateObservableGauge(
            "mockexchange.rate.achieved",
            () => AchievedEventsPerSecond,
            "events/s",
            "Rate actually produced, over a rolling window rather than since start-up.");
    }

    /// <summary>Consumers currently connected.</summary>
    internal int ActiveSessions => _activeSessions();

    /// <summary>The rate the market session is currently asking for, in events/sec.</summary>
    internal double TargetEventsPerSecond => Volatile.Read(ref _targetRate);

    /// <summary>The rate actually achieved over the rolling window, in events/sec.</summary>
    internal double AchievedEventsPerSecond => _achieved.EventsPerSecond();

    /// <summary>The market phase in force as of the last <see cref="SetTarget"/>.</summary>
    internal MarketPhase Phase => _phase;

    /// <summary>How long this instance has existed, which is how long the exchange has been up.</summary>
    internal TimeSpan Uptime => _timeProvider.GetUtcNow() - _startedAt;

    /// <summary>Records generated, lifetime.</summary>
    internal long GeneratedTotal => Interlocked.Read(ref _generatedTotal);

    /// <summary>Records handed to at least one session, lifetime.</summary>
    internal long PublishedTotal => Interlocked.Read(ref _publishedTotal);

    /// <summary>Records withheld from a session, lifetime, summed across sessions.</summary>
    internal long DroppedTotal => Interlocked.Read(ref _droppedTotal);

    /// <summary>Connections admitted, lifetime.</summary>
    internal long AcceptedTotal => Interlocked.Read(ref _acceptedTotal);

    /// <summary>Connections refused, lifetime.</summary>
    internal long RejectedTotal => Interlocked.Read(ref _rejectedTotal);

    /// <summary>Sessions ended, lifetime.</summary>
    internal long ClosedTotal => Interlocked.Read(ref _closedTotal);

    /// <summary>Sessions killed by the slow-consumer policy, lifetime.</summary>
    internal long SlowDisconnectedTotal => Interlocked.Read(ref _slowDisconnectedTotal);

    /// <summary>Payload bytes written to sockets, lifetime.</summary>
    internal long BytesWrittenTotal => Interlocked.Read(ref _bytesWrittenTotal);

    /// <summary>
    /// Points <c>mockexchange.sessions.active</c> at an authoritative reading, normally
    /// <c>FeedServer.ActiveSessionCount</c>.
    /// </summary>
    /// <remarks>
    /// Called once at composition time, after the server exists. It cannot be a constructor
    /// argument: the server takes the metrics, so the metrics cannot take the server. The delegate
    /// is invoked on whichever thread collects the gauge, so it must be cheap and non-throwing
    /// &#8212; an array-length read is exactly the right shape.
    /// </remarks>
    internal void BindSessionCount(Func<int> source)
    {
        ArgumentNullException.ThrowIfNull(source);
        _activeSessions = source;
    }

    /// <summary>
    /// Records one generated batch of <paramref name="count"/> events.
    /// </summary>
    /// <remarks>
    /// Once per batch. Never call this per event: at 25,000/sec that is 125 times the instrument
    /// traffic for the same information. Allocation-free, and asserted so.
    /// </remarks>
    internal void RecordBatch(int count)
    {
        if (count <= 0)
        {
            return;
        }

        Interlocked.Add(ref _generatedTotal, count);
        _eventsGenerated.Add(count);
        _batchSize.Record(count);
        _achieved.Add(count);
    }

    /// <summary>Records how late the batch that just ran woke relative to its deadline.</summary>
    /// <remarks>
    /// The sample is kept twice: in the histogram, for an exporter, and in a small ring, because a
    /// <see cref="Histogram{T}"/> cannot be read back and the reporter needs a percentile. The ring
    /// write is a masked array store with no bounds on which thread does it; a reader racing a
    /// writer sees one stale sample out of a thousand, which cannot move a p99 enough to matter.
    /// </remarks>
    internal void RecordPacingLag(TimeSpan lag)
    {
        double ms = lag.TotalMilliseconds;

        if (ms < 0)
        {
            ms = 0;
        }

        _pacingLag.Record(ms);

        long slot = Interlocked.Increment(ref _lagWrites) - 1;
        _lagSamples[(int)(slot & LagSampleMask)] = ms;
    }

    /// <summary>
    /// Records the outcome of publishing a batch: <paramref name="records"/> records offered to
    /// <paramref name="sessionsReached"/> sessions.
    /// </summary>
    /// <remarks>
    /// <c>events.published</c> counts records that reached <em>at least one</em> consumer, so a
    /// batch generated into an empty roster raises <c>events.generated</c> and not this. The gap
    /// between the two is time the exchange spent talking to nobody, which is worth being able to
    /// see rather than inferring from a session count.
    /// </remarks>
    internal void RecordPublished(int records, int sessionsReached)
    {
        if (sessionsReached > 0 && records > 0)
        {
            Interlocked.Add(ref _publishedTotal, records);
            _eventsPublished.Add(records);
        }

        if (sessionsReached > 0)
        {
            _publishSessionsReached.Add(sessionsReached);
        }
    }

    /// <summary>Records the phase and the rate being asked for, as of the batch about to run.</summary>
    internal void SetTarget(MarketPhase phase, double eventsPerSecond)
    {
        _phase = phase;
        Volatile.Write(ref _targetRate, double.IsNaN(eventsPerSecond) ? 0 : eventsPerSecond);
    }

    /// <summary>
    /// The 99th percentile of the retained pacing-lag samples, in milliseconds; zero if none have
    /// been recorded.
    /// </summary>
    /// <remarks>
    /// Computed on demand and allocating, which is fine at one call every five seconds and is why
    /// it is not done on the batch path.
    /// </remarks>
    internal double PacingLagP99Ms()
    {
        long writes = Interlocked.Read(ref _lagWrites);

        if (writes == 0)
        {
            return 0;
        }

        int n = (int)Math.Min(writes, LagSampleCapacity);
        double[] sorted = new double[n];
        Array.Copy(_lagSamples, sorted, n);
        Array.Sort(sorted);

        int index = (int)Math.Ceiling(0.99 * n) - 1;
        return sorted[Math.Clamp(index, 0, n - 1)];
    }

    /// <inheritdoc />
    public void SessionAccepted(Guid sessionId)
    {
        Interlocked.Increment(ref _acceptedTotal);
        _sessionsAccepted.Add(1);
    }

    /// <inheritdoc />
    public void SessionRejected(string reason)
    {
        Interlocked.Increment(ref _rejectedTotal);
        _sessionsRejected.Add(1, new KeyValuePair<string, object?>(ReasonTag, reason));
    }

    /// <inheritdoc />
    public void SessionClosed(Guid sessionId, string reason)
    {
        Interlocked.Increment(ref _closedTotal);
        _sessionsClosed.Add(1, new KeyValuePair<string, object?>(ReasonTag, reason));
    }

    /// <inheritdoc />
    public void SlowConsumerDisconnected(Guid sessionId)
    {
        Interlocked.Increment(ref _slowDisconnectedTotal);
        _sessionsSlowDisconnected.Add(1);
    }

    /// <inheritdoc />
    /// <remarks>
    /// Reached from the publish path when a session is behind &#8212; once per refused batch, not
    /// per record. That path is already the degraded one, but it is still <c>Publish</c>, so this
    /// stays two interlocked adds and a boxed tag: no lock, no dictionary, no log. The box is one
    /// small gen0 object per refused batch, bounded by the batch rate rather than the event rate,
    /// and it buys the attribution that makes this counter worth having.
    /// </remarks>
    public void RecordsDropped(Guid sessionId, long records)
    {
        if (records <= 0)
        {
            return;
        }

        Interlocked.Add(ref _droppedTotal, records);
        _eventsDropped.Add(records, new KeyValuePair<string, object?>(SessionIdTag, sessionId));
    }

    /// <inheritdoc />
    public void BytesWritten(Guid sessionId, long bytes)
    {
        if (bytes <= 0)
        {
            return;
        }

        Interlocked.Add(ref _bytesWrittenTotal, bytes);
        _bytesWritten.Add(bytes, new KeyValuePair<string, object?>(SessionIdTag, sessionId));
    }

    public void Dispose() => _meter.Dispose();

    /// <summary>
    /// Sessions currently open according to the accept/close ledger. The fallback for
    /// <c>sessions.active</c> until <see cref="BindSessionCount"/> supplies the real reading.
    /// </summary>
    private int SessionLedgerCount()
    {
        long open = Interlocked.Read(ref _acceptedTotal) - Interlocked.Read(ref _closedTotal);
        return open <= 0 ? 0 : (int)Math.Min(open, int.MaxValue);
    }
}
