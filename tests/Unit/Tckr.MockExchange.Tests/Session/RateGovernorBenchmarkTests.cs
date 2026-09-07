using System.Diagnostics;
using Tckr.MockExchange.Session;
using Xunit.Abstractions;

namespace Tckr.MockExchange.Tests.Session;

/// <summary>
/// The only test in this area that uses the real clock for a meaningful length of time. Fake time
/// proves the arithmetic; nothing but wall time proves the pacing, because timer granularity,
/// scheduler latency and GC pauses are exactly what fake time abstracts away.
/// </summary>
/// <remarks>
/// Skipped in Debug: a tiered-JIT warm-up in the first second of a ten-second run moves the
/// numbers enough to make the assertions unreliable, and a flaky test in the default suite is
/// worse than a measurement taken on purpose. Run it with
/// <c>dotnet test -c Release --filter Category=Benchmark</c>.
/// </remarks>
[Trait("Category", "Benchmark")]
public class RateGovernorBenchmarkTests(ITestOutputHelper output)
{
    private const int BatchIntervalMs = 5;
    private const double TargetRate = 25_000;

#if DEBUG
    [Fact(Skip = "Wall-clock measurement; run with: dotnet test -c Release --filter Category=Benchmark")]
#else
    [Fact]
#endif
    public async Task SustainsTheTargetRateOnTheRealClockForTenSeconds()
    {
        TimeSpan runFor = TimeSpan.FromSeconds(10);
        RateGovernor governor = new(BatchIntervalMs, RateGovernor.DefaultMaxCatchUpBatches);

        List<double> lagMs = new(4096);
        long start = Stopwatch.GetTimestamp();
        int batches = 0;
        TimeSpan elapsed;

        while (true)
        {
            await governor.WaitForNextBatchAsync(TargetRate, CancellationToken.None);
            elapsed = Stopwatch.GetElapsedTime(start);
            batches++;

            // Per-batch jitter is how late this batch woke relative to the deadline it was
            // scheduled for. Counting calls instead would be wrong: one call covers several
            // intervals whenever the governor makes up a short stall, so a within-cap catch-up
            // would show up for ever after as a fixed offset that the pacing does not have.
            lagMs.Add(governor.CurrentLag.TotalMilliseconds);

            if (elapsed >= runFor)
            {
                break;
            }
        }

        double achieved = governor.TotalEventsScheduled / elapsed.TotalSeconds;
        double error = Math.Abs(achieved - TargetRate) / TargetRate;

        // Where the schedule as a whole ended up, independent of how many calls carried it.
        double scheduleMs = (governor.TotalEventsScheduled / TargetRate * 1000) - BatchIntervalMs;
        double cumulativeDriftMs = elapsed.TotalMilliseconds - scheduleMs;

        lagMs.Sort();
        double p99 = lagMs[(int)(lagMs.Count * 0.99)];
        double p50 = lagMs[lagMs.Count / 2];

        output.WriteLine($"batches           : {batches}");
        output.WriteLine($"elapsed           : {elapsed.TotalSeconds:F3} s");
        output.WriteLine($"events scheduled  : {governor.TotalEventsScheduled:N0}");
        output.WriteLine($"achieved rate     : {achieved:N1} events/sec (target {TargetRate:N0}, error {error:P3})");
        output.WriteLine($"per-batch jitter  : p50 {p50:F3} ms, p99 {p99:F3} ms, max {lagMs[^1]:F3} ms");
        output.WriteLine($"cumulative drift  : {cumulativeDriftMs:F3} ms over {elapsed.TotalSeconds:F1} s");
        output.WriteLine($"catch-up dropped  : {governor.CatchUpBatchesDropped} batches");
        output.WriteLine($"spin iterations   : {governor.SpinIterations:N0}");

        error.ShouldBeLessThan(0.02, $"achieved {achieved:N1} events/sec against a target of {TargetRate:N0}");
        p99.ShouldBeLessThan(15.0, $"p99 per-batch jitter was {p99:F3} ms");

        // Any dropped batch is an admission that the loop stalled; a handful is survivable on a
        // shared machine. The real guard is the achieved-rate assertion above, which is what
        // dropped batches actually cost.
        double droppedShare = governor.CatchUpBatchesDropped / (double)batches;
        droppedShare.ShouldBeLessThan(0.02, $"dropped {governor.CatchUpBatchesDropped} of {batches} batches");
    }
}
