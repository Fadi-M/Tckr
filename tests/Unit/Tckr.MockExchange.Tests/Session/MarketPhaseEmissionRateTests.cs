using Microsoft.Extensions.Time.Testing;
using Tckr.MockExchange.Options;
using Tckr.MockExchange.Session;

namespace Tckr.MockExchange.Tests.Session;

/// <summary>
/// Closes the Phase 2 coverage gap on Definition of Done item 7: "market phases visibly change
/// the emission rate (opening burst &gt; continuous &gt; lull)."
/// </summary>
/// <remarks>
/// <para>
/// <see cref="MarketSessionClockTests"/> proves the clock resolves the correct phase and
/// multiplier from a timestamp &#8212; a pure function, no governor involved.
/// <see cref="RateGovernorTests"/> proves the governor paces accurately &#8212; but every test
/// there drives it with a constant, hand-supplied rate. Neither proves the thing the DoD item
/// actually claims: that wiring the two together, the way the publisher loop does, produces a
/// different <em>measured</em> event count per phase.
/// </para>
/// <para>
/// Every test here drives the exact loop shape documented for task 06's publisher
/// (<c>session.Advance</c> before <c>governor.WaitForNextBatchAsync</c>, same
/// <see cref="FakeTimeProvider"/> instance behind both), and advances the fake clock one batch
/// interval ahead of each call &#8212; the same technique <see cref="RateGovernorTests"/> uses so a
/// multi-minute simulated run completes synchronously, with no thread waits and no flakiness.
/// </para>
/// </remarks>
public class MarketPhaseEmissionRateTests
{
    private const int BatchIntervalMs = 5;
    private const double BaseRate = 1_000; // chosen so every phase multiplier below lands on a whole number of events/batch

    private static readonly TimeSpan Interval = TimeSpan.FromMilliseconds(BatchIntervalMs);

    private static DateTimeOffset At(int hour, int minute) =>
        new(2026, 3, 4, hour, minute, 0, TimeSpan.Zero);

    /// <summary>
    /// One sample per phase: a timestamp safely inside its window (default schedule, see
    /// <see cref="MarketSessionOptions.CreateDefaultPhases"/>) and the multiplier the clock is
    /// expected to report there.
    /// </summary>
    private static readonly (MarketPhase Phase, int Hour, int Minute, double Multiplier)[] PhaseSamples =
    [
        (MarketPhase.PreOpen, 9, 45, 0.10),
        (MarketPhase.OpeningAuction, 10, 2, 3.00),
        (MarketPhase.ContinuousMorning, 11, 0, 1.20),
        (MarketPhase.MiddayLull, 12, 45, 0.60),
        (MarketPhase.ContinuousAfternoon, 13, 45, 1.00),
        (MarketPhase.ClosingAuction, 14, 20, 2.50),
    ];

    /// <summary>
    /// Runs the clock + governor pair, wired exactly as task 06's publisher loop wires them, for
    /// <paramref name="duration"/> of simulated time starting at <paramref name="start"/>, and
    /// returns every batch's timestamp and emitted count.
    /// </summary>
    private static async Task<List<(DateTimeOffset At, int Count)>> RunAsync(
        FakeTimeProvider clock, MarketSessionClock session, RateGovernor governor, TimeSpan duration)
    {
        List<(DateTimeOffset At, int Count)> batches = [];

        for (TimeSpan elapsed = TimeSpan.Zero; elapsed < duration; elapsed += Interval)
        {
            DateTimeOffset now = clock.GetUtcNow();
            session.Advance(now);
            double rate = session.EffectiveEventsPerSecond(BaseRate);
            int count = await governor.WaitForNextBatchAsync(rate, CancellationToken.None);
            batches.Add((now, count));
            clock.Advance(Interval);
        }

        return batches;
    }

    private static async Task<double> MeasureEffectiveRateAsync(
        int hour, int minute, MarketPhase expectedPhase, TimeSpan duration)
    {
        FakeTimeProvider clock = new(At(hour, minute));
        MarketSessionClock session = new(new MarketSessionOptions { Mode = MarketSessionMode.Scheduled }, clock);
        RateGovernor governor = new(BatchIntervalMs, RateGovernor.DefaultMaxCatchUpBatches, clock);

        // Sanity: the sample time must actually land in the phase it claims to, with enough
        // margin that a short run never crosses into the next window and contaminates the count.
        session.Advance(clock.GetUtcNow());
        session.CurrentPhase.ShouldBe(expectedPhase);

        List<(DateTimeOffset At, int Count)> batches = await RunAsync(clock, session, governor, duration);

        return batches.Sum(b => (long)b.Count) / duration.TotalSeconds;
    }

    /// <summary>
    /// The core claim of DoD item 7, measured rather than assumed: driving the clock and governor
    /// together produces a strictly higher emitted rate for the opening burst than for continuous
    /// trading, and a strictly lower rate for the midday lull &#8212; and every phase lands within a
    /// tight tolerance of the rate its configured multiplier asks for, so the phases are honoured
    /// quantitatively, not merely in relative order.
    /// </summary>
    [Fact]
    public async Task EachPhaseEmitsAtItsConfiguredEffectiveRateInAscendingMultiplierOrder()
    {
        TimeSpan duration = TimeSpan.FromSeconds(2);
        Dictionary<MarketPhase, double> observed = [];

        foreach ((MarketPhase phase, int hour, int minute, double multiplier) in PhaseSamples)
        {
            double rate = await MeasureEffectiveRateAsync(hour, minute, phase, duration);
            observed[phase] = rate;

            double expected = BaseRate * multiplier;
            Math.Abs(rate - expected).ShouldBeLessThan(Math.Max(expected * 0.005, 0.5), $"{phase} measured rate off target");
        }

        // The DoD's own claim, as a strict ordering: opening auction > continuous trading > midday lull.
        observed[MarketPhase.OpeningAuction].ShouldBeGreaterThan(observed[MarketPhase.ContinuousMorning]);
        observed[MarketPhase.ContinuousMorning].ShouldBeGreaterThan(observed[MarketPhase.MiddayLull]);

        // The full default schedule, quantitatively, low to high:
        // PreOpen < MiddayLull < ContinuousAfternoon < ContinuousMorning < ClosingAuction < OpeningAuction.
        observed[MarketPhase.PreOpen].ShouldBeLessThan(observed[MarketPhase.MiddayLull]);
        observed[MarketPhase.MiddayLull].ShouldBeLessThan(observed[MarketPhase.ContinuousAfternoon]);
        observed[MarketPhase.ContinuousAfternoon].ShouldBeLessThan(observed[MarketPhase.ContinuousMorning]);
        observed[MarketPhase.ContinuousMorning].ShouldBeLessThan(observed[MarketPhase.ClosingAuction]);
        observed[MarketPhase.ClosingAuction].ShouldBeLessThan(observed[MarketPhase.OpeningAuction]);
    }

    /// <summary>
    /// Crosses the PreOpen &#8594; OpeningAuction boundary (0.10x &#8594; 3.00x, the sharpest jump in the
    /// default schedule) inside one continuous governor run, and shows the batch scheduled at the
    /// boundary already reflects the new phase's rate &#8212; no lag from the governor averaging the
    /// old and new rate together, and no leftover burst or gap from the debt carried across the
    /// change.
    /// </summary>
    [Fact]
    public async Task EmissionRateReflectsTheNewPhaseImmediatelyAtAPhaseBoundary()
    {
        DateTimeOffset boundary = At(10, 0); // PreOpen (0.10x) -> OpeningAuction (3.00x)
        DateTimeOffset start = boundary - TimeSpan.FromSeconds(10);

        FakeTimeProvider clock = new(start);
        MarketSessionClock session = new(new MarketSessionOptions { Mode = MarketSessionMode.Scheduled }, clock);
        RateGovernor governor = new(BatchIntervalMs, RateGovernor.DefaultMaxCatchUpBatches, clock);

        List<(DateTimeOffset At, int Count)> batches =
            await RunAsync(clock, session, governor, TimeSpan.FromSeconds(20));

        long beforeBoundary = batches
            .Where(b => b.At >= boundary - TimeSpan.FromSeconds(1) && b.At < boundary)
            .Sum(b => (long)b.Count);
        long afterBoundary = batches
            .Where(b => b.At >= boundary && b.At < boundary + TimeSpan.FromSeconds(1))
            .Sum(b => (long)b.Count);

        beforeBoundary.ShouldBe(100);   // PreOpen: 1,000 x 0.10 = 100/s, exactly
        afterBoundary.ShouldBe(3_000);  // OpeningAuction: 1,000 x 3.00 = 3,000/s, exactly

        // The very first batch at or after the boundary already carries the new rate in full -
        // not a fraction of it, and not the stale PreOpen rate one batch late.
        int firstBatchAtOrAfterBoundary = batches.First(b => b.At >= boundary).Count;
        firstBatchAtOrAfterBoundary.ShouldBe(15); // 3,000/s over one 5 ms batch

        // And the batch immediately before it is still fully at the old rate: the boundary is a
        // clean cut, not a blend.
        int lastBatchBeforeBoundary = batches.Last(b => b.At < boundary).Count;
        lastBatchBeforeBoundary.ShouldBeLessThan(firstBatchAtOrAfterBoundary);
    }

    /// <summary>
    /// The closing auction is the second burst of the day. Crossing into it from the afternoon
    /// session (1.00x &#8594; 2.50x) proves the immediate-effect behaviour is not special-cased to the
    /// opening boundary.
    /// </summary>
    [Fact]
    public async Task EmissionRateReflectsTheNewPhaseImmediatelyAtTheClosingAuctionBoundary()
    {
        DateTimeOffset boundary = At(14, 15); // ContinuousAfternoon (1.00x) -> ClosingAuction (2.50x)
        DateTimeOffset start = boundary - TimeSpan.FromSeconds(10);

        FakeTimeProvider clock = new(start);
        MarketSessionClock session = new(new MarketSessionOptions { Mode = MarketSessionMode.Scheduled }, clock);
        RateGovernor governor = new(BatchIntervalMs, RateGovernor.DefaultMaxCatchUpBatches, clock);

        List<(DateTimeOffset At, int Count)> batches =
            await RunAsync(clock, session, governor, TimeSpan.FromSeconds(20));

        long beforeBoundary = batches
            .Where(b => b.At >= boundary - TimeSpan.FromSeconds(1) && b.At < boundary)
            .Sum(b => (long)b.Count);
        long afterBoundary = batches
            .Where(b => b.At >= boundary && b.At < boundary + TimeSpan.FromSeconds(1))
            .Sum(b => (long)b.Count);

        beforeBoundary.ShouldBe(1_000);  // ContinuousAfternoon: 1,000 x 1.00 = 1,000/s
        afterBoundary.ShouldBe(2_500);   // ClosingAuction: 1,000 x 2.50 = 2,500/s
        afterBoundary.ShouldBeGreaterThan(beforeBoundary);
    }
}
