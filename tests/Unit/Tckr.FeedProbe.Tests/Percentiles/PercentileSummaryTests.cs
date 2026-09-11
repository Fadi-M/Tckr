namespace Tckr.FeedProbe.Tests.Percentiles;

/// <summary>
/// <see cref="PercentileSummary.FromNanoseconds"/>: the empty/singleton/pair edge cases, an
/// exact-boundary percentile index, and a fully hand-computed known-input case.
/// </summary>
public class PercentileSummaryTests
{
    private const double NanosPerMs = 1_000_000.0;

    [Fact]
    public void EmptyInputIsTheEmptySummary()
    {
        PercentileSummary summary = PercentileSummary.FromNanoseconds([]);

        summary.ShouldBe(PercentileSummary.Empty);
        summary.P50Ms.ShouldBe(0);
        summary.P95Ms.ShouldBe(0);
        summary.P99Ms.ShouldBe(0);
        summary.MaxMs.ShouldBe(0);
    }

    [Fact]
    public void SingleSampleIsEveryPercentile()
    {
        long[] samples = [7_000_000]; // 7ms

        PercentileSummary summary = PercentileSummary.FromNanoseconds(samples);

        summary.P50Ms.ShouldBe(7.0);
        summary.P95Ms.ShouldBe(7.0);
        summary.P99Ms.ShouldBe(7.0);
        summary.MaxMs.ShouldBe(7.0);
    }

    [Fact]
    public void TwoSamplesSplitP50FromP95AndP99()
    {
        // Nearest-rank over n=2: index = ceil(p*2)-1. p50 -> ceil(1)-1=0 (the smaller); p95/p99 ->
        // ceil(1.9)-1=1 and ceil(1.98)-1=1 (the larger). Hand-computed, not just "whatever the code
        // returns".
        long[] samples = [20_000_000, 10_000_000]; // unsorted on purpose: 20ms, 10ms

        PercentileSummary summary = PercentileSummary.FromNanoseconds(samples);

        summary.P50Ms.ShouldBe(10.0);
        summary.P95Ms.ShouldBe(20.0);
        summary.P99Ms.ShouldBe(20.0);
        summary.MaxMs.ShouldBe(20.0);
    }

    [Fact]
    public void ExactPercentileBoundariesOverOneHundredSamples()
    {
        // Values 1ms..100ms. Nearest-rank: index = ceil(p*100)-1.
        // p50 -> ceil(50)-1 = 49 -> the 50th smallest -> 50ms.
        // p95 -> ceil(95)-1 = 94 -> the 95th smallest -> 95ms.
        // p99 -> ceil(99)-1 = 98 -> the 99th smallest -> 99ms.
        long[] samples = new long[100];
        for (int i = 0; i < 100; i++)
        {
            samples[i] = (i + 1) * (long)NanosPerMs;
        }

        PercentileSummary summary = PercentileSummary.FromNanoseconds(samples);

        summary.P50Ms.ShouldBe(50.0);
        summary.P95Ms.ShouldBe(95.0);
        summary.P99Ms.ShouldBe(99.0);
        summary.MaxMs.ShouldBe(100.0);
    }

    [Fact]
    public void KnownInputHandComputedAgainstNearestRankPercentiles()
    {
        // Unsorted 1..5 ms. Sorted: [1,2,3,4,5].
        // p50 -> ceil(2.5)-1 = 2 -> 3rd smallest -> 3ms.
        // p95 -> ceil(4.75)-1 = 4 -> 5th smallest -> 5ms.
        // p99 -> ceil(4.95)-1 = 4 -> 5th smallest -> 5ms.
        long[] samples = [5, 1, 4, 2, 3];
        long[] samplesNanos = Array.ConvertAll(samples, ms => ms * (long)NanosPerMs);

        PercentileSummary summary = PercentileSummary.FromNanoseconds(samplesNanos);

        summary.P50Ms.ShouldBe(3.0);
        summary.P95Ms.ShouldBe(5.0);
        summary.P99Ms.ShouldBe(5.0);
        summary.MaxMs.ShouldBe(5.0);
    }

    [Fact]
    public void DoesNotMutateTheInputArray()
    {
        long[] samples = [30_000_000, 10_000_000, 20_000_000];
        long[] original = (long[])samples.Clone();

        _ = PercentileSummary.FromNanoseconds(samples);

        samples.ShouldBe(original);
    }
}
