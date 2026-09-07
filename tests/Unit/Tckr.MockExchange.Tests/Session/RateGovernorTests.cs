using System.Diagnostics;
using Microsoft.Extensions.Logging.Testing;
using Microsoft.Extensions.Time.Testing;
using Tckr.MockExchange.Session;

namespace Tckr.MockExchange.Tests.Session;

/// <summary>
/// Pacing accuracy under a virtual clock.
/// </summary>
/// <remarks>
/// Every test here drives the governor by advancing the fake clock <em>before</em> each call, so
/// each batch is already due when it is asked for and the whole run completes synchronously. That
/// is deliberate: it exercises the real
/// <see cref="RateGovernor.WaitForNextBatchAsync"/> accounting path with no threads, no races and
/// no wall-clock time, which is what makes a 10-simulated-minute drift test cost milliseconds.
/// The waiting path itself is covered separately by
/// <see cref="WaitsForTheDeadlineRatherThanReturningEarly"/> and by the wall-clock benchmark.
/// </remarks>
public class RateGovernorTests
{
    private const int BatchIntervalMs = 5;
    private const int BatchesPerSecond = 1000 / BatchIntervalMs;

    private static readonly DateTimeOffset Origin = new(2026, 3, 4, 9, 0, 0, TimeSpan.Zero);
    private static readonly TimeSpan Interval = TimeSpan.FromMilliseconds(BatchIntervalMs);

    private static FakeTimeProvider NewClock() => new(Origin);

    /// <summary>Runs <paramref name="batches"/> batches at a constant rate, returning what was scheduled.</summary>
    private static async Task<long> RunAsync(RateGovernor governor, FakeTimeProvider clock, double rate, int batches)
    {
        long total = 0;

        for (int i = 0; i < batches; i++)
        {
            total += await governor.WaitForNextBatchAsync(rate, CancellationToken.None);
            clock.Advance(Interval);
        }

        return total;
    }

    [Fact]
    public async Task SchedulesTheTargetRateOverASimulatedMinute()
    {
        FakeTimeProvider clock = NewClock();
        RateGovernor governor = new(BatchIntervalMs, RateGovernor.DefaultMaxCatchUpBatches, clock);

        long scheduled = await RunAsync(governor, clock, 25_000, 60 * BatchesPerSecond);

        scheduled.ShouldBe(1_500_000);
        governor.TotalEventsScheduled.ShouldBe(scheduled);
        governor.CatchUpBatchesDropped.ShouldBe(0);
        governor.CurrentLag.ShouldBe(TimeSpan.Zero);
    }

    /// <summary>
    /// The fractional carry is the whole point of debt accounting. At 17,384/sec a 5 ms batch owes
    /// 86.92 events; truncating each batch throws away 0.92 events 200 times a second, for ever.
    /// </summary>
    [Fact]
    public async Task CarriesTheFractionalRemainderAtNonRoundRates()
    {
        const double Rate = 17_384;
        const int Batches = 60 * BatchesPerSecond;

        FakeTimeProvider clock = NewClock();
        RateGovernor governor = new(BatchIntervalMs, RateGovernor.DefaultMaxCatchUpBatches, clock);

        long scheduled = await RunAsync(governor, clock, Rate, Batches);

        double expected = Rate * 60;
        Math.Abs(scheduled - expected).ShouldBeLessThan(expected * 0.005);
        governor.PendingFraction.ShouldBeInRange(0, 1);

        // The bug this guards against, measured rather than asserted from memory: per-batch
        // integer truncation loses more than 1% at this rate, which is twenty times the tolerance
        // the accuracy tests are held to.
        long truncated = (long)(Rate * BatchIntervalMs / 1000d) * Batches;
        double truncationShortfall = (expected - truncated) / expected;
        truncationShortfall.ShouldBeGreaterThan(0.01);
    }

    /// <summary>
    /// Error must not accumulate: the cumulative total has to track the schedule at every minute
    /// of a ten-minute run, not merely arrive at the right endpoint.
    /// </summary>
    [Fact]
    public async Task DoesNotDriftOverTenSimulatedMinutes()
    {
        const double Rate = 25_000;

        FakeTimeProvider clock = NewClock();
        RateGovernor governor = new(BatchIntervalMs, RateGovernor.DefaultMaxCatchUpBatches, clock);

        for (int minute = 1; minute <= 10; minute++)
        {
            await RunAsync(governor, clock, Rate, 60 * BatchesPerSecond);

            double expectedSoFar = Rate * 60 * minute;
            double error = Math.Abs(governor.TotalEventsScheduled - expectedSoFar) / expectedSoFar;
            error.ShouldBeLessThan(0.005, $"drifted at minute {minute}");
        }

        governor.TotalEventsScheduled.ShouldBe(15_000_000);
        governor.CatchUpBatchesDropped.ShouldBe(0);
    }

    [Fact]
    public async Task MakesUpASmallStallWithinTheCatchUpCap()
    {
        FakeTimeProvider clock = NewClock();
        RateGovernor governor = new(BatchIntervalMs, maxCatchUpBatches: 4, clock);

        (await governor.WaitForNextBatchAsync(25_000, CancellationToken.None)).ShouldBe(125);

        // 20 ms late: the batch that was due plus three missed ones, all inside the cap.
        clock.Advance(TimeSpan.FromMilliseconds(20));

        (await governor.WaitForNextBatchAsync(25_000, CancellationToken.None)).ShouldBe(4 * 125);
        governor.CatchUpBatchesDropped.ShouldBe(0);
        governor.CurrentLag.ShouldBe(TimeSpan.FromMilliseconds(15));
    }

    /// <summary>
    /// A 500 ms stall is 100 batches at the default interval. Emitting all of them would hand the
    /// publisher a 12,500-event burst and make the next stall worse; the governor emits the capped
    /// amount, abandons the rest, counts it, and returns to normal batches immediately.
    /// </summary>
    [Fact]
    public async Task CapsCatchUpAfterAStallAndResetsTheSchedule()
    {
        FakeTimeProvider clock = NewClock();
        FakeLogger<RateGovernor> logger = new();
        RateGovernor governor = new(BatchIntervalMs, maxCatchUpBatches: 4, clock, logger);

        await governor.WaitForNextBatchAsync(25_000, CancellationToken.None);

        clock.Advance(TimeSpan.FromMilliseconds(500));
        int afterStall = await governor.WaitForNextBatchAsync(25_000, CancellationToken.None);

        // The due batch plus the four the cap allows: 5 x 125, not the 100 x 125 owed.
        afterStall.ShouldBe(5 * 125);
        governor.CurrentLag.ShouldBe(TimeSpan.FromMilliseconds(495));
        governor.CatchUpBatchesDropped.ShouldBe(95);   // 99 missed batches, 4 made up

        logger.Collector.GetSnapshot()
            .Count(r => r.Level == Microsoft.Extensions.Logging.LogLevel.Warning)
            .ShouldBe(1);

        // The schedule now runs from the stall, not from the abandoned deadlines.
        for (int i = 0; i < 10; i++)
        {
            clock.Advance(Interval);
            (await governor.WaitForNextBatchAsync(25_000, CancellationToken.None)).ShouldBe(125);
        }

        governor.CatchUpBatchesDropped.ShouldBe(95);
        governor.CurrentLag.ShouldBe(TimeSpan.Zero);
    }

    [Fact]
    public async Task AppliesARateChangeOnTheNextBatchWithoutABurstOrAGap()
    {
        FakeTimeProvider clock = NewClock();
        RateGovernor governor = new(BatchIntervalMs, RateGovernor.DefaultMaxCatchUpBatches, clock);

        long before = await RunAsync(governor, clock, 25_000, 100);
        before.ShouldBe(100 * 125);

        int firstAfterChange = await governor.WaitForNextBatchAsync(50_000, CancellationToken.None);
        clock.Advance(Interval);

        firstAfterChange.ShouldBe(250);           // the new rate exactly: no catch-up burst
        long after = await RunAsync(governor, clock, 50_000, 99);
        after.ShouldBe(99 * 250);                 // and no gap on the batches that follow

        governor.TotalEventsScheduled.ShouldBe((100 * 125) + (100 * 250));
    }

    [Fact]
    public async Task SchedulesNothingWhileTheMarketIsClosedAndCarriesNoDebtIntoTheOpen()
    {
        FakeTimeProvider clock = NewClock();
        RateGovernor governor = new(BatchIntervalMs, RateGovernor.DefaultMaxCatchUpBatches, clock);

        long closed = await RunAsync(governor, clock, 0, 200);

        closed.ShouldBe(0);
        governor.TotalEventsScheduled.ShouldBe(0);
        governor.CatchUpBatchesDropped.ShouldBe(0);

        // Re-opening must not repay a second's worth of "missed" events.
        (await governor.WaitForNextBatchAsync(25_000, CancellationToken.None)).ShouldBe(125);
    }

    /// <summary>
    /// A zero rate must be paced, not polled: the wait has nothing to be accurate about, so the
    /// spin phase &#8212; the part that deliberately burns a core &#8212; must not engage at all.
    /// </summary>
    [Fact]
    public async Task DoesNotSpinHotAtAZeroRate()
    {
        RateGovernor governor = new(BatchIntervalMs, RateGovernor.DefaultMaxCatchUpBatches);

        long start = Stopwatch.GetTimestamp();
        for (int i = 0; i < 20; i++)
        {
            (await governor.WaitForNextBatchAsync(0, CancellationToken.None)).ShouldBe(0);
        }

        TimeSpan elapsed = Stopwatch.GetElapsedTime(start);

        governor.SpinIterations.ShouldBe(0);

        // ... and it still paced: 19 intervals of real waiting, not a tight loop of no-ops.
        elapsed.ShouldBeGreaterThan(TimeSpan.FromMilliseconds(19 * BatchIntervalMs * 0.8));
    }

    /// <summary>
    /// The other half of the same trade: against the real clock at a real rate the spin phase
    /// does engage, because that is the only thing that closes the last two milliseconds
    /// accurately.
    /// </summary>
    [Fact]
    public async Task SpinsToCloseTheLastMillisecondsAgainstTheRealClock()
    {
        RateGovernor governor = new(BatchIntervalMs, RateGovernor.DefaultMaxCatchUpBatches);

        for (int i = 0; i < 20; i++)
        {
            await governor.WaitForNextBatchAsync(25_000, CancellationToken.None);
        }

        governor.SpinIterations.ShouldBeGreaterThan(0);
    }

    [Fact]
    public async Task WaitsForTheDeadlineRatherThanReturningEarly()
    {
        FakeTimeProvider clock = NewClock();
        RateGovernor governor = new(BatchIntervalMs, RateGovernor.DefaultMaxCatchUpBatches, clock);

        await governor.WaitForNextBatchAsync(25_000, CancellationToken.None);

        Task<int> pending = governor.WaitForNextBatchAsync(25_000, CancellationToken.None).AsTask();
        pending.IsCompleted.ShouldBeFalse();

        for (int i = 0; i < 6 && !pending.IsCompleted; i++)
        {
            clock.Advance(TimeSpan.FromMilliseconds(1));
            await Task.Yield();
        }

        (await pending.WaitAsync(TimeSpan.FromSeconds(10))).ShouldBe(125);
    }

    [Fact]
    public async Task CancelsTheWait()
    {
        FakeTimeProvider clock = NewClock();
        RateGovernor governor = new(BatchIntervalMs, RateGovernor.DefaultMaxCatchUpBatches, clock);
        using CancellationTokenSource cts = new();

        await governor.WaitForNextBatchAsync(25_000, cts.Token);

        Task<int> pending = governor.WaitForNextBatchAsync(25_000, cts.Token).AsTask();
        await cts.CancelAsync();

        await Should.ThrowAsync<OperationCanceledException>(() => pending.WaitAsync(TimeSpan.FromSeconds(10)));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void RejectsAnUnusableBatchInterval(int batchIntervalMs) =>
        Should.Throw<ArgumentOutOfRangeException>(() => new RateGovernor(batchIntervalMs, 4));

    [Fact]
    public async Task RejectsANegativeRate()
    {
        RateGovernor governor = new(BatchIntervalMs, 4, NewClock());

        await Should.ThrowAsync<ArgumentOutOfRangeException>(
            async () => await governor.WaitForNextBatchAsync(-1, CancellationToken.None));
        await Should.ThrowAsync<ArgumentOutOfRangeException>(
            async () => await governor.WaitForNextBatchAsync(double.NaN, CancellationToken.None));
    }
}
