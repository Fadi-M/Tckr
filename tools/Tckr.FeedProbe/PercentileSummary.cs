namespace Tckr.FeedProbe;

/// <summary>p50/p95/p99/max over a batch of nanosecond samples, expressed in milliseconds.</summary>
internal readonly record struct PercentileSummary(double P50Ms, double P95Ms, double P99Ms, double MaxMs)
{
    internal static PercentileSummary Empty { get; } = new(0, 0, 0, 0);

    /// <summary>
    /// Sorts a copy of <paramref name="samplesNanos"/> and reads off the requested percentiles.
    /// </summary>
    /// <remarks>
    /// Called once per run, at the end — this is the "compute at the end" half of the reservoir
    /// design, never on the per-event path.
    /// </remarks>
    internal static PercentileSummary FromNanoseconds(long[] samplesNanos)
    {
        if (samplesNanos.Length == 0)
        {
            return Empty;
        }

        long[] sorted = (long[])samplesNanos.Clone();
        Array.Sort(sorted);

        return new PercentileSummary(
            ToMs(At(sorted, 0.50)),
            ToMs(At(sorted, 0.95)),
            ToMs(At(sorted, 0.99)),
            ToMs(sorted[^1]));
    }

    private static double ToMs(long nanos) => nanos / 1_000_000.0;

    /// <summary>Nearest-rank percentile: the smallest value at or above the requested fraction of the sample.</summary>
    private static long At(long[] sorted, double p)
    {
        int index = (int)Math.Ceiling(p * sorted.Length) - 1;
        return sorted[Math.Clamp(index, 0, sorted.Length - 1)];
    }
}
