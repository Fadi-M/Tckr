using System.Diagnostics.Metrics;
using Microsoft.Extensions.Diagnostics.Metrics.Testing;
using Microsoft.Extensions.Time.Testing;
using Tckr.MockExchange.Diagnostics;
using Tckr.MockExchange.Feed;
using Tckr.MockExchange.Session;

namespace Tckr.MockExchange.Tests.Diagnostics;

/// <summary>
/// The meter, its instruments, and the properties that make them worth trusting: batch-granular
/// recording, a rolling achieved rate, and a tag set that cannot become a cardinality problem.
/// </summary>
/// <remarks>
/// Every instance is created with its own scope object so a collector sees this test's meter and
/// not one belonging to a test running beside it. Without that, xUnit's per-class parallelism
/// turns every count assertion into a race against whatever else is publishing to
/// <c>Tckr.MockExchange</c> at the time.
/// </remarks>
public class FeedMetricsTests : IDisposable
{
    private static readonly DateTimeOffset Origin = new(2026, 3, 4, 9, 30, 0, TimeSpan.Zero);
    private static readonly TimeSpan Batch = TimeSpan.FromMilliseconds(5);

    private readonly List<FeedMetrics> _created = [];

    /// <summary>Meters outlive the object that made them until disposed, so every one is tracked.</summary>
    public void Dispose()
    {
        foreach (FeedMetrics metrics in _created)
        {
            metrics.Dispose();
        }

        GC.SuppressFinalize(this);
    }

    private (FeedMetrics Metrics, object Scope, FakeTimeProvider Clock) NewMetrics()
    {
        object scope = new();
        FakeTimeProvider clock = new(Origin);
        FeedMetrics metrics = new(clock, scope);
        _created.Add(metrics);
        return (metrics, scope, clock);
    }

    private static MetricCollector<T> Collect<T>(object scope, string instrument) where T : struct
        => new(scope, FeedMetrics.MeterName, instrument);

    [Fact]
    public void RecordBatchCountsTheBatchOnceAndTheEventsInIt()
    {
        (FeedMetrics metrics, object scope, _) = NewMetrics();
        using MetricCollector<long> generated = Collect<long>(scope, "mockexchange.events.generated");
        using MetricCollector<int> size = Collect<int>(scope, "mockexchange.batch.size");

        metrics.RecordBatch(125);

        generated.GetMeasurementSnapshot().Count.ShouldBe(1);
        generated.LastMeasurement!.Value.ShouldBe(125);
        size.GetMeasurementSnapshot().Count.ShouldBe(1);
        size.LastMeasurement!.Value.ShouldBe(125);
        metrics.GeneratedTotal.ShouldBe(125);
    }

    /// <summary>
    /// The hot-path rule, stated as an assertion. Two hundred batches of 125 is one second at the
    /// 25,000/sec target: 200 instrument calls, not 25,000.
    /// </summary>
    [Fact]
    public void ASecondOfGenerationIsTwoHundredMeasurements()
    {
        (FeedMetrics metrics, object scope, _) = NewMetrics();
        using MetricCollector<long> generated = Collect<long>(scope, "mockexchange.events.generated");

        for (int i = 0; i < 200; i++)
        {
            metrics.RecordBatch(125);
        }

        generated.GetMeasurementSnapshot().Count.ShouldBe(200);
        metrics.GeneratedTotal.ShouldBe(25_000);
    }

    [Fact]
    public void EveryInstrumentCarriesTheNameAndUnitTheDashboardsWillBeBuiltAgainst()
    {
        (FeedMetrics metrics, object scope, FakeTimeProvider clock) = NewMetrics();
        using MeterProbe probe = new(scope);

        Exercise(metrics, clock);
        probe.ObserveGauges();

        Dictionary<string, string?> expected = new()
        {
            ["mockexchange.events.generated"] = "events",
            ["mockexchange.events.published"] = "events",
            ["mockexchange.events.dropped"] = "events",
            ["mockexchange.sessions.active"] = "sessions",
            ["mockexchange.sessions.accepted"] = "sessions",
            ["mockexchange.sessions.rejected"] = "sessions",
            ["mockexchange.sessions.closed"] = "sessions",
            ["mockexchange.sessions.slow_disconnected"] = "sessions",
            ["mockexchange.publish.sessions_reached"] = "sessions",
            ["mockexchange.rate.target"] = "events/s",
            ["mockexchange.rate.achieved"] = "events/s",
            ["mockexchange.pacing.lag"] = "ms",
            ["mockexchange.batch.size"] = "events",
            ["mockexchange.session.bytes_written"] = "bytes",
        };

        probe.Names.OrderBy(n => n).ShouldBe(expected.Keys.OrderBy(n => n));

        foreach (MeterProbe.Measurement measurement in probe.Measurements)
        {
            measurement.Unit.ShouldBe(expected[measurement.Name], $"{measurement.Name} has the wrong unit.");
        }
    }

    /// <summary>
    /// The cardinality guard. Not just "no symbol tag" but "no tag outside the allow-list": the way
    /// a symbol tag arrives is on an instrument added later by someone who did not read this file,
    /// so the assertion is closed rather than open.
    /// </summary>
    [Fact]
    public void NoInstrumentIsTaggedWithASymbolOrAnythingElseUnbounded()
    {
        (FeedMetrics metrics, object scope, FakeTimeProvider clock) = NewMetrics();
        using MeterProbe probe = new(scope);

        Exercise(metrics, clock);
        probe.ObserveGauges();

        string[] allowed = [FeedMetrics.SessionIdTag, FeedMetrics.ReasonTag];

        foreach (MeterProbe.Measurement measurement in probe.Measurements)
        {
            foreach (KeyValuePair<string, object?> tag in measurement.Tags)
            {
                tag.Key.ShouldNotBe("symbol");
                allowed.ShouldContain(tag.Key, $"{measurement.Name} carries an unexpected tag '{tag.Key}'.");
            }
        }
    }

    /// <summary>
    /// Only the two instruments that answer "which consumer?" carry a session id. Tagging the
    /// lifetime counters as well would multiply their series by every consumer that ever connected,
    /// for information the session's own log line already carries.
    /// </summary>
    [Fact]
    public void OnlyThePerConsumerInstrumentsCarryASessionId()
    {
        (FeedMetrics metrics, object scope, FakeTimeProvider clock) = NewMetrics();
        using MeterProbe probe = new(scope);

        Exercise(metrics, clock);
        probe.ObserveGauges();

        string[] tagged =
        [
            .. probe.Measurements
                .Where(m => m.Tags.Any(t => t.Key == FeedMetrics.SessionIdTag))
                .Select(m => m.Name)
                .Distinct()
                .OrderBy(n => n),
        ];

        tagged.ShouldBe(["mockexchange.events.dropped", "mockexchange.session.bytes_written"]);
    }

    [Fact]
    public void SessionLifecycleEventsLandOnTheirCountersWithAReasonTag()
    {
        (FeedMetrics metrics, object scope, _) = NewMetrics();
        using MetricCollector<long> accepted = Collect<long>(scope, "mockexchange.sessions.accepted");
        using MetricCollector<long> rejected = Collect<long>(scope, "mockexchange.sessions.rejected");
        using MetricCollector<long> closed = Collect<long>(scope, "mockexchange.sessions.closed");
        using MetricCollector<long> slow = Collect<long>(scope, "mockexchange.sessions.slow_disconnected");

        Guid session = Guid.NewGuid();
        metrics.SessionAccepted(session);
        metrics.SessionRejected("max-sessions");
        metrics.SlowConsumerDisconnected(session);
        metrics.SessionClosed(session, FeedSession.Reasons.SlowConsumerLoss);

        accepted.LastMeasurement!.Value.ShouldBe(1);
        rejected.LastMeasurement!.Tags[FeedMetrics.ReasonTag].ShouldBe("max-sessions");
        slow.LastMeasurement!.Value.ShouldBe(1);
        closed.LastMeasurement!.Tags[FeedMetrics.ReasonTag].ShouldBe("slow-consumer-loss");

        metrics.AcceptedTotal.ShouldBe(1);
        metrics.RejectedTotal.ShouldBe(1);
        metrics.SlowDisconnectedTotal.ShouldBe(1);
        metrics.ClosedTotal.ShouldBe(1);
    }

    /// <summary>
    /// Every reason the feed server can close a session must be usable as a metric dimension. This
    /// also pins the rename of <c>slow-consumer-thinning</c> to <c>slow-consumer-loss</c>: if the
    /// constant moves again, the tag set moves with it rather than silently splitting a series.
    /// </summary>
    [Fact]
    public void EveryCloseReasonTheServerUsesIsAStableTag()
    {
        (FeedMetrics metrics, object scope, _) = NewMetrics();
        using MetricCollector<long> closed = Collect<long>(scope, "mockexchange.sessions.closed");

        string[] reasons =
        [
            FeedSession.Reasons.SlowConsumer,
            FeedSession.Reasons.SlowConsumerLoss,
            FeedSession.Reasons.ClientClosed,
            FeedSession.Reasons.ClientReset,
            FeedSession.Reasons.WriteFailed,
            FeedSession.Reasons.ServerShutdown,
        ];

        foreach (string reason in reasons)
        {
            metrics.SessionClosed(Guid.NewGuid(), reason);
        }

        string?[] tagged = [.. closed.GetMeasurementSnapshot().Select(m => (string?)m.Tags[FeedMetrics.ReasonTag])];

        tagged.ShouldBe(
        [
            "slow-consumer", "slow-consumer-loss", "client-closed",
            "client-reset", "write-failed", "server-shutdown",
        ]);
    }

    [Fact]
    public void PublishedCountsRecordsThatReachedSomeoneAndNothingElse()
    {
        (FeedMetrics metrics, object scope, _) = NewMetrics();
        using MetricCollector<long> published = Collect<long>(scope, "mockexchange.events.published");
        using MetricCollector<long> reached = Collect<long>(scope, "mockexchange.publish.sessions_reached");

        metrics.RecordPublished(125, sessionsReached: 0);
        metrics.RecordPublished(125, sessionsReached: 2);

        published.GetMeasurementSnapshot().Count.ShouldBe(1);
        metrics.PublishedTotal.ShouldBe(125);
        reached.LastMeasurement!.Value.ShouldBe(2);
    }

    [Fact]
    public void DroppedAndBytesAreAttributedToTheirSession()
    {
        (FeedMetrics metrics, object scope, _) = NewMetrics();
        using MetricCollector<long> dropped = Collect<long>(scope, "mockexchange.events.dropped");
        using MetricCollector<long> bytes = Collect<long>(scope, "mockexchange.session.bytes_written");

        Guid session = Guid.NewGuid();
        metrics.RecordsDropped(session, 2_700);
        metrics.BytesWritten(session, 39_644);

        dropped.LastMeasurement!.Value.ShouldBe(2_700);
        dropped.LastMeasurement!.Tags[FeedMetrics.SessionIdTag].ShouldBe(session);
        bytes.LastMeasurement!.Value.ShouldBe(39_644);
        bytes.LastMeasurement!.Tags[FeedMetrics.SessionIdTag].ShouldBe(session);

        metrics.DroppedTotal.ShouldBe(2_700);
        metrics.BytesWrittenTotal.ShouldBe(39_644);
    }

    [Fact]
    public void TheAchievedGaugeMatchesTheVolumeItWasFed()
    {
        (FeedMetrics metrics, object scope, FakeTimeProvider clock) = NewMetrics();
        using MetricCollector<double> achieved = Collect<double>(scope, "mockexchange.rate.achieved");

        Generate(metrics, clock, 25_000, TimeSpan.FromSeconds(5));
        achieved.RecordObservableInstruments();

        achieved.LastMeasurement!.Value.ShouldBe(25_000, 250);
    }

    /// <summary>
    /// The gauge is a window, not a mean. A run that generated at target for half the window and
    /// nothing for the other half must report the collapse rather than the average of the two.
    /// </summary>
    [Fact]
    public void TheAchievedGaugeShowsAMidRunCollapse()
    {
        (FeedMetrics metrics, object scope, FakeTimeProvider clock) = NewMetrics();
        using MetricCollector<double> achieved = Collect<double>(scope, "mockexchange.rate.achieved");

        Generate(metrics, clock, 25_000, TimeSpan.FromSeconds(5));
        achieved.RecordObservableInstruments();
        double healthy = achieved.LastMeasurement!.Value;

        clock.Advance(TimeSpan.FromSeconds(5));
        achieved.RecordObservableInstruments();

        healthy.ShouldBe(25_000, 250);
        achieved.LastMeasurement!.Value.ShouldBe(0);

        // The cumulative average over the same ten seconds would still read 12,500/sec.
        (metrics.GeneratedTotal / 10.0).ShouldBe(12_500, 250);
    }

    [Fact]
    public void TheTargetGaugeReportsWhatTheSessionAsksFor()
    {
        (FeedMetrics metrics, object scope, _) = NewMetrics();
        using MetricCollector<double> target = Collect<double>(scope, "mockexchange.rate.target");

        metrics.SetTarget(MarketPhase.OpeningAuction, 75_000);
        target.RecordObservableInstruments();

        target.LastMeasurement!.Value.ShouldBe(75_000);
        metrics.Phase.ShouldBe(MarketPhase.OpeningAuction);
        metrics.TargetEventsPerSecond.ShouldBe(75_000);
    }

    /// <summary>
    /// The gauge falls back to the accept/close ledger so it is never silently zero, and
    /// <see cref="FeedMetrics.BindSessionCount"/> replaces it with the server's own reading once
    /// there is a server to read. The binding cannot be a constructor argument: the server takes
    /// the metrics, so the metrics cannot take the server.
    /// </summary>
    [Fact]
    public void TheActiveGaugeCountsSessionsUntilSomethingAuthoritativeIsBound()
    {
        (FeedMetrics metrics, object scope, _) = NewMetrics();
        using MetricCollector<int> active = Collect<int>(scope, "mockexchange.sessions.active");

        Guid first = Guid.NewGuid();
        metrics.SessionAccepted(first);
        metrics.SessionAccepted(Guid.NewGuid());
        active.RecordObservableInstruments();
        int ledger = active.LastMeasurement!.Value;

        metrics.SessionClosed(first, FeedSession.Reasons.ClientClosed);
        active.RecordObservableInstruments();
        int afterClose = active.LastMeasurement!.Value;

        metrics.BindSessionCount(() => 7);
        active.RecordObservableInstruments();

        ledger.ShouldBe(2);
        afterClose.ShouldBe(1);
        active.LastMeasurement!.Value.ShouldBe(7);
    }

    [Fact]
    public void PacingLagIsRecordedAndReadableAsAPercentile()
    {
        (FeedMetrics metrics, object scope, _) = NewMetrics();
        using MetricCollector<double> lag = Collect<double>(scope, "mockexchange.pacing.lag");

        for (int i = 0; i < 100; i++)
        {
            metrics.RecordPacingLag(TimeSpan.FromMilliseconds(i + 1));
        }

        // The 99th of a hundred sorted samples, not the maximum: a p99 that returns the worst
        // sample is a max wearing a percentile's name.
        lag.GetMeasurementSnapshot().Count.ShouldBe(100);
        metrics.PacingLagP99Ms().ShouldBe(99);
    }

    [Fact]
    public void PacingLagP99IsZeroBeforeAnythingIsRecorded()
    {
        (FeedMetrics metrics, _, _) = NewMetrics();

        metrics.PacingLagP99Ms().ShouldBe(0);
    }

    [Fact]
    public void UptimeComesFromTheInjectedClock()
    {
        (FeedMetrics metrics, _, FakeTimeProvider clock) = NewMetrics();

        clock.Advance(TimeSpan.FromMinutes(2) + TimeSpan.FromSeconds(15));

        metrics.Uptime.ShouldBe(TimeSpan.FromSeconds(135));
    }

    [Fact]
    public void TheMeterIsNamedForThePhase14Dashboards()
    {
        FeedMetrics.MeterName.ShouldBe("Tckr.MockExchange");
    }

    /// <summary>Generates <paramref name="eventsPerSecond"/> in 5 ms batches for <paramref name="duration"/>.</summary>
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

    /// <summary>Touches every instrument once, so a probe sees the complete surface.</summary>
    private static void Exercise(FeedMetrics metrics, FakeTimeProvider clock)
    {
        Guid session = Guid.NewGuid();

        metrics.SetTarget(MarketPhase.ContinuousMorning, 25_000);
        metrics.SessionAccepted(session);
        metrics.SessionRejected("max-sessions");
        metrics.RecordBatch(125);
        metrics.RecordPacingLag(TimeSpan.FromMilliseconds(0.4));
        metrics.RecordPublished(125, sessionsReached: 1);
        metrics.BytesWritten(session, 5_500);
        metrics.RecordsDropped(session, 12);
        metrics.SlowConsumerDisconnected(session);
        metrics.SessionClosed(session, FeedSession.Reasons.SlowConsumerLoss);

        clock.Advance(TimeSpan.FromSeconds(1));
    }
}
