using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Testing;
using Microsoft.Extensions.Time.Testing;
using Tckr.MockExchange.Diagnostics;
using Tckr.MockExchange.Feed;
using Tckr.MockExchange.Session;

namespace Tckr.MockExchange.Tests.Diagnostics;

/// <summary>
/// The status line, and the three ways it escalates.
/// </summary>
/// <remarks>
/// The reporting step is driven directly rather than through the timer in most of these tests. The
/// timer is one line and is covered once; the escalation rules are the part that decides whether a
/// silently under-delivering benchmark run is noticed, and they deserve assertions that cannot
/// race.
/// </remarks>
public class ThroughputReporterTests : IDisposable
{
    private static readonly DateTimeOffset Origin = new(2026, 3, 4, 9, 30, 0, TimeSpan.Zero);
    private static readonly TimeSpan Batch = TimeSpan.FromMilliseconds(5);

    private readonly List<FeedMetrics> _created = [];

    public void Dispose()
    {
        foreach (FeedMetrics metrics in _created)
        {
            metrics.Dispose();
        }

        GC.SuppressFinalize(this);
    }

    [Fact]
    public void ReportsAtInformationWhenTheExchangeIsDeliveringWhatItPromised()
    {
        (ThroughputReporter reporter, FeedMetrics metrics, FakeLogger<ThroughputReporter> logger, FakeTimeProvider clock) = NewReporter();

        metrics.SetTarget(MarketPhase.ContinuousMorning, 25_000);
        metrics.BindSessionCount(() => 1);
        Generate(metrics, clock, 25_000, TimeSpan.FromSeconds(5));

        reporter.Report();

        FakeLogRecord record = logger.LatestRecord;
        record.Level.ShouldBe(LogLevel.Information);
        record.Message.ShouldContain("phase=ContinuousMorning");
        record.Message.ShouldContain("target=25000/s");
        record.Message.ShouldContain("sessions=1");
        record.Message.ShouldContain("uptime=00:00:05");
    }

    /// <summary>
    /// The headline rule. One short interval is a GC pause or a phase change; two in a row is a
    /// trend, and a benchmark that under-delivers for ten seconds has already invalidated whatever
    /// was measured against it.
    /// </summary>
    [Fact]
    public void WarnsOnlyAfterTwoConsecutiveIntervalsBelowNinetyFivePercent()
    {
        (ThroughputReporter reporter, FeedMetrics metrics, FakeLogger<ThroughputReporter> logger, FakeTimeProvider clock) = NewReporter();

        metrics.SetTarget(MarketPhase.ContinuousMorning, 25_000);
        metrics.BindSessionCount(() => 1);

        Generate(metrics, clock, 20_000, TimeSpan.FromSeconds(5));
        reporter.Report();
        LogLevel first = logger.LatestRecord.Level;

        Generate(metrics, clock, 20_000, TimeSpan.FromSeconds(5));
        reporter.Report();

        first.ShouldBe(LogLevel.Information);
        logger.LatestRecord.Level.ShouldBe(LogLevel.Warning);
        reporter.ConsecutiveShortfalls.ShouldBe(2);
        logger.LatestRecord.Message.ShouldContain("(80.0%)");
    }

    [Fact]
    public void AGoodIntervalResetsTheShortfallStreak()
    {
        (ThroughputReporter reporter, FeedMetrics metrics, FakeLogger<ThroughputReporter> logger, FakeTimeProvider clock) = NewReporter();

        metrics.SetTarget(MarketPhase.ContinuousMorning, 25_000);
        metrics.BindSessionCount(() => 1);

        Generate(metrics, clock, 20_000, TimeSpan.FromSeconds(5));
        reporter.Report();

        Generate(metrics, clock, 25_000, TimeSpan.FromSeconds(5));
        reporter.Report();

        Generate(metrics, clock, 20_000, TimeSpan.FromSeconds(5));
        reporter.Report();

        reporter.ConsecutiveShortfalls.ShouldBe(1);
        logger.LatestRecord.Level.ShouldBe(LogLevel.Information);
    }

    /// <summary>
    /// A closed market has no target to fall short of. Without this, every overnight lull warns by
    /// morning and the warning stops meaning anything.
    /// </summary>
    [Fact]
    public void AZeroTargetNeverCountsAsUnderDelivery()
    {
        (ThroughputReporter reporter, FeedMetrics metrics, FakeLogger<ThroughputReporter> logger, FakeTimeProvider clock) = NewReporter();

        metrics.SetTarget(MarketPhase.Closed, 0);
        clock.Advance(TimeSpan.FromSeconds(5));

        reporter.Report();
        reporter.Report();

        reporter.ConsecutiveShortfalls.ShouldBe(0);
        logger.LatestRecord.Level.ShouldBe(LogLevel.Information);
    }

    [Fact]
    public void WarnsAsSoonAsRecordsAreDropped()
    {
        (ThroughputReporter reporter, FeedMetrics metrics, FakeLogger<ThroughputReporter> logger, FakeTimeProvider clock) = NewReporter();

        metrics.SetTarget(MarketPhase.ContinuousMorning, 25_000);
        metrics.BindSessionCount(() => 1);
        Generate(metrics, clock, 25_000, TimeSpan.FromSeconds(5));

        reporter.Report();
        LogLevel healthy = logger.LatestRecord.Level;

        metrics.RecordsDropped(Guid.NewGuid(), 2_700);
        Generate(metrics, clock, 25_000, TimeSpan.FromSeconds(5));
        reporter.Report();

        healthy.ShouldBe(LogLevel.Information);
        logger.LatestRecord.Level.ShouldBe(LogLevel.Warning);
        logger.LatestRecord.Message.ShouldContain("dropped=2700");
    }

    [Fact]
    public void WarnsAsSoonAsASlowConsumerIsDisconnected()
    {
        (ThroughputReporter reporter, FeedMetrics metrics, FakeLogger<ThroughputReporter> logger, FakeTimeProvider clock) = NewReporter();

        metrics.SetTarget(MarketPhase.ContinuousMorning, 25_000);
        metrics.BindSessionCount(() => 1);
        Generate(metrics, clock, 25_000, TimeSpan.FromSeconds(5));
        reporter.Report();

        metrics.SlowConsumerDisconnected(Guid.NewGuid());
        metrics.SessionClosed(Guid.NewGuid(), FeedSession.Reasons.SlowConsumer);
        Generate(metrics, clock, 25_000, TimeSpan.FromSeconds(5));
        reporter.Report();

        logger.LatestRecord.Level.ShouldBe(LogLevel.Warning);
        logger.LatestRecord.Message.ShouldContain("slow_disconnects=1");
    }

    /// <summary>
    /// A steady loss counter must stop warning. A counter that has moved once and warns for ever
    /// afterwards is the same as no warning at all.
    /// </summary>
    [Fact]
    public void StopsWarningOnceTheLossCountersHoldStill()
    {
        (ThroughputReporter reporter, FeedMetrics metrics, FakeLogger<ThroughputReporter> logger, FakeTimeProvider clock) = NewReporter();

        metrics.SetTarget(MarketPhase.ContinuousMorning, 25_000);
        metrics.BindSessionCount(() => 1);
        Generate(metrics, clock, 25_000, TimeSpan.FromSeconds(5));

        metrics.RecordsDropped(Guid.NewGuid(), 10);
        reporter.Report();
        LogLevel moved = logger.LatestRecord.Level;

        Generate(metrics, clock, 25_000, TimeSpan.FromSeconds(5));
        reporter.Report();

        moved.ShouldBe(LogLevel.Warning);
        logger.LatestRecord.Level.ShouldBe(LogLevel.Information);
    }

    /// <summary>
    /// Generation runs whether or not anyone is connected, so the rate stays healthy while the
    /// feed reaches nobody. Saying so is the difference between a status line and a misleading one.
    /// </summary>
    [Fact]
    public void SaysSoWhenNoConsumerIsConnected()
    {
        (ThroughputReporter reporter, FeedMetrics metrics, FakeLogger<ThroughputReporter> logger, FakeTimeProvider clock) = NewReporter();

        metrics.SetTarget(MarketPhase.ContinuousMorning, 25_000);
        Generate(metrics, clock, 25_000, TimeSpan.FromSeconds(5));

        reporter.Report();

        logger.LatestRecord.Message.ShouldContain("no consumers connected");
        logger.LatestRecord.Message.ShouldContain("sessions=0");
    }

    [Fact]
    public void DropsTheNoConsumerNoteAsSoonAsOneConnects()
    {
        (ThroughputReporter reporter, FeedMetrics metrics, FakeLogger<ThroughputReporter> logger, FakeTimeProvider clock) = NewReporter();

        metrics.SetTarget(MarketPhase.ContinuousMorning, 25_000);
        metrics.SessionAccepted(Guid.NewGuid());
        Generate(metrics, clock, 25_000, TimeSpan.FromSeconds(5));

        reporter.Report();

        logger.LatestRecord.Message.ShouldNotContain("no consumers connected");
    }

    /// <summary>
    /// Every number in the line is a named property, not a value interpolated into the template.
    /// That is what makes the line queryable in a log store rather than only readable in a console.
    /// </summary>
    [Fact]
    public void EveryFigureIsAStructuredProperty()
    {
        (ThroughputReporter reporter, FeedMetrics metrics, FakeLogger<ThroughputReporter> logger, FakeTimeProvider clock) = NewReporter();

        metrics.SetTarget(MarketPhase.ContinuousMorning, 25_000);
        metrics.BindSessionCount(() => 1);
        Generate(metrics, clock, 25_000, TimeSpan.FromSeconds(5));

        reporter.Report();

        string[] properties = [.. logger.LatestRecord.StructuredState!.Select(p => p.Key)];

        properties.ShouldContain("Phase");
        properties.ShouldContain("TargetRate");
        properties.ShouldContain("AchievedRate");
        properties.ShouldContain("AchievedPercent");
        properties.ShouldContain("Sessions");
        properties.ShouldContain("LagP99Ms");
        properties.ShouldContain("DroppedRecords");
        properties.ShouldContain("SlowDisconnects");
        properties.ShouldContain("Uptime");
    }

    [Fact]
    public void ReportsThePacingLagPercentile()
    {
        (ThroughputReporter reporter, FeedMetrics metrics, FakeLogger<ThroughputReporter> logger, FakeTimeProvider clock) = NewReporter();

        metrics.SetTarget(MarketPhase.ContinuousMorning, 25_000);
        metrics.BindSessionCount(() => 1);
        Generate(metrics, clock, 25_000, TimeSpan.FromSeconds(5));

        for (int i = 0; i < 100; i++)
        {
            metrics.RecordPacingLag(TimeSpan.FromMilliseconds(i == 0 ? 3.2 : 0.1));
        }

        reporter.Report();

        logger.LatestRecord.Message.ShouldContain("lag_p99=");
    }

    /// <summary>The timer path, driven once against a virtual clock, plus the final line on the way out.</summary>
    [Fact]
    public async Task TicksOnItsIntervalAndReportsOnceMoreWhenStopped()
    {
        (ThroughputReporter reporter, FeedMetrics metrics, FakeLogger<ThroughputReporter> logger, FakeTimeProvider clock) = NewReporter();

        metrics.SetTarget(MarketPhase.ContinuousMorning, 25_000);
        await reporter.StartAsync(CancellationToken.None);

        try
        {
            // Let the service reach its first await before the clock moves under it. The yield is
            // the ordering guarantee &#8212; the test's continuation is queued behind the one that
            // starts the loop &#8212; and the delay is insurance for a loaded machine. A tick
            // raised before the timer exists is simply lost, which reads as a broken reporter.
            await Task.Yield();
            await Task.Delay(50);
            logger.Collector.Count.ShouldBe(0);

            clock.Advance(TimeSpan.FromSeconds(5));
            await WaitForRecordsAsync(logger, 1);

            clock.Advance(TimeSpan.FromSeconds(5));
            await WaitForRecordsAsync(logger, 2);
        }
        finally
        {
            await reporter.StopAsync(CancellationToken.None);
        }

        // Two ticks plus the shutdown line.
        logger.Collector.Count.ShouldBe(3);
    }

    [Fact]
    public void RejectsAnIntervalThatWouldNeverReport()
    {
        using FeedMetrics metrics = new();
        FakeLogger<ThroughputReporter> logger = new();

        Should.Throw<ArgumentOutOfRangeException>(
            () => new ThroughputReporter(metrics, logger, TimeProvider.System, 0));
    }

    private (ThroughputReporter Reporter, FeedMetrics Metrics, FakeLogger<ThroughputReporter> Logger, FakeTimeProvider Clock) NewReporter()
    {
        FakeTimeProvider clock = new(Origin);
        FeedMetrics metrics = new(clock, new object());
        _created.Add(metrics);

        FakeLogger<ThroughputReporter> logger = new();
        ThroughputReporter reporter = new(metrics, logger, clock, ThroughputReporter.DefaultReportIntervalSeconds);

        return (reporter, metrics, logger, clock);
    }

    private static void Generate(FeedMetrics metrics, FakeTimeProvider clock, double eventsPerSecond, TimeSpan duration)
    {
        int batches = (int)(duration / Batch);
        int perBatch = (int)(eventsPerSecond * Batch.TotalSeconds);

        for (int i = 0; i < batches; i++)
        {
            metrics.RecordBatch(perBatch);
            clock.Advance(Batch);
        }
    }

    /// <summary>
    /// The timer's continuation runs on the thread pool, so advancing a virtual clock and reading
    /// the log in the next statement is a race. Poll instead, with a bound that fails the test
    /// rather than hanging it.
    /// </summary>
    private static async Task WaitForRecordsAsync(FakeLogger<ThroughputReporter> logger, int count)
    {
        DateTime deadline = DateTime.UtcNow.AddSeconds(5);

        while (logger.Collector.Count < count && DateTime.UtcNow < deadline)
        {
            await Task.Delay(5);
        }

        logger.Collector.Count.ShouldBeGreaterThanOrEqualTo(count);
    }
}
