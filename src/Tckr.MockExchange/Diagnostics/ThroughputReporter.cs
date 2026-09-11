using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Tckr.MockExchange.Diagnostics;

/// <summary>
/// Logs one structured line every few seconds saying what the exchange is actually doing, and
/// raises it to <see cref="LogLevel.Warning"/> when what it is doing is not what it was asked for.
/// </summary>
/// <remarks>
/// <para>
/// The failure this exists to catch is the quiet one. A mock exchange that under-delivers does not
/// crash, does not throw, and produces a benchmark result that looks like a downstream problem.
/// Every escalation rule below is aimed at that: under-delivery, dropped records and
/// slow-consumer disconnects are the three ways this component can invalidate a measurement
/// without failing, so all three are Warnings rather than lines in a status feed.
/// </para>
/// <para>
/// <b>Two consecutive intervals, not one.</b> A single interval below 95% is what a GC pause or a
/// phase transition looks like from here, and warning on it trains the reader to ignore the
/// warning. Two in a row is a trend.
/// </para>
/// <para>
/// <b>No consumers is stated, not implied.</b> Generation runs whether or not anyone is connected
/// &#8212; that is the component's central property &#8212; so the achieved rate stays healthy
/// while the feed goes nowhere. A status line that reports 25,000/sec without mentioning that it
/// reached no one is technically true and practically a lie.
/// </para>
/// </remarks>
internal sealed class ThroughputReporter : BackgroundService
{
    /// <summary>Default reporting interval, in seconds.</summary>
    internal const int DefaultReportIntervalSeconds = 5;

    /// <summary>Fraction of target below which delivery counts as short.</summary>
    internal const double UnderDeliveryThreshold = 0.95;

    /// <summary>Consecutive short intervals before the line is raised to Warning.</summary>
    internal const int ShortfallIntervalsBeforeWarning = 2;

    private const string StatusTemplate =
        "Feed status phase={Phase} target={TargetRate:F0}/s achieved={AchievedRate:F0}/s ({AchievedPercent:F1}%) " +
        "sessions={Sessions} lag_p99={LagP99Ms:F1}ms dropped={DroppedRecords} slow_disconnects={SlowDisconnects} " +
        "uptime={Uptime:hh\\:mm\\:ss}";

    private const string NoConsumerTemplate =
        "Feed status phase={Phase} target={TargetRate:F0}/s achieved={AchievedRate:F0}/s ({AchievedPercent:F1}%) " +
        "sessions={Sessions} no consumers connected lag_p99={LagP99Ms:F1}ms dropped={DroppedRecords} " +
        "slow_disconnects={SlowDisconnects} uptime={Uptime:hh\\:mm\\:ss}";

    private readonly FeedMetrics _metrics;
    private readonly ILogger<ThroughputReporter> _logger;
    private readonly TimeProvider _timeProvider;
    private readonly TimeSpan _interval;

    private int _consecutiveShortfalls;
    private long _lastDropped;
    private long _lastSlowDisconnects;

    /// <summary>Creates the reporter.</summary>
    /// <param name="metrics">The meter's mirrors, which is where every number in the line comes from.</param>
    /// <param name="logger">Destination for the status line.</param>
    /// <param name="timeProvider">
    /// Drives the interval timer. Injected so the escalation rules can be tested without waiting
    /// ten real seconds for two intervals.
    /// </param>
    /// <param name="reportIntervalSeconds">
    /// Seconds between lines. Bound by task 06 from <c>ThroughputReportIntervalSeconds</c>; it is a
    /// constructor argument rather than an options type because <c>Options/</c> belongs to that task.
    /// </param>
    internal ThroughputReporter(
        FeedMetrics metrics,
        ILogger<ThroughputReporter> logger,
        TimeProvider? timeProvider = null,
        int reportIntervalSeconds = DefaultReportIntervalSeconds)
    {
        ArgumentNullException.ThrowIfNull(metrics);
        ArgumentNullException.ThrowIfNull(logger);
        ArgumentOutOfRangeException.ThrowIfLessThan(reportIntervalSeconds, 1);

        _metrics = metrics;
        _logger = logger;
        _timeProvider = timeProvider ?? TimeProvider.System;
        _interval = TimeSpan.FromSeconds(reportIntervalSeconds);
    }

    /// <summary>Consecutive intervals in which achieved fell below <see cref="UnderDeliveryThreshold"/> of target.</summary>
    internal int ConsecutiveShortfalls => _consecutiveShortfalls;

    /// <summary>
    /// Emits one status line and updates the escalation state.
    /// </summary>
    /// <remarks>
    /// Separate from the timer loop so the escalation rules can be driven directly by a test. The
    /// percentile is only computed if something is listening, because sorting a thousand samples
    /// to hand them to a disabled logger is pure waste.
    /// </remarks>
    internal void Report()
    {
        double target = _metrics.TargetEventsPerSecond;
        double achieved = _metrics.AchievedEventsPerSecond;
        long dropped = _metrics.DroppedTotal;
        long slowDisconnects = _metrics.SlowDisconnectedTotal;
        int sessions = _metrics.ActiveSessions;

        // A closed market has no target to fall short of, so it resets the streak rather than
        // scoring against it. Otherwise every overnight lull would warn by morning.
        bool shortfall = target > 0 && achieved < target * UnderDeliveryThreshold;
        _consecutiveShortfalls = shortfall ? _consecutiveShortfalls + 1 : 0;

        bool lossMoved = dropped != _lastDropped || slowDisconnects != _lastSlowDisconnects;
        _lastDropped = dropped;
        _lastSlowDisconnects = slowDisconnects;

        LogLevel level = _consecutiveShortfalls >= ShortfallIntervalsBeforeWarning || lossMoved
            ? LogLevel.Warning
            : LogLevel.Information;

        if (!_logger.IsEnabled(level))
        {
            return;
        }

        _logger.Log(
            level,
            sessions == 0 ? NoConsumerTemplate : StatusTemplate,
            _metrics.Phase,
            target,
            achieved,
            target > 0 ? achieved / target * 100.0 : 0.0,
            sessions,
            _metrics.PacingLagP99Ms(),
            dropped,
            slowDisconnects,
            _metrics.Uptime);
    }

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using PeriodicTimer timer = new(_interval, _timeProvider);

        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false))
            {
                Report();
            }
        }
        catch (OperationCanceledException)
        {
            // Shutdown, not a fault.
        }

        // One last line on the way out. A run's final numbers are the ones a benchmark quotes, and
        // without this they are whatever the last tick happened to catch up to five seconds ago.
        Report();
    }
}
