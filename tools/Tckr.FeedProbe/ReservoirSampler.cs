namespace Tckr.FeedProbe;

/// <summary>
/// Fixed-capacity uniform reservoir (Vitter's Algorithm R) over a stream of <see cref="long"/>
/// samples.
/// </summary>
/// <remarks>
/// A percentile estimate needs a sorted sample, not every point ever seen, and a genuinely
/// unbounded run (<c>--duration 0</c>) cannot pre-size an array for "every point". A reservoir
/// gives a bounded, pre-allocated buffer whose contents are an unbiased uniform subset of the whole
/// stream, which is exactly what a percentile needs. It is used for every run, not only
/// <c>--duration 0</c> ones: a fixed-duration run at 25,000/sec for 60 seconds is 1.5 million
/// samples, comfortably past a capacity sized for interactive percentile computation, so one code
/// path serves both cases instead of two that must independently stay correct under load.
/// <para>
/// <see cref="Add"/> is O(1) and allocation-free, so it is safe on the probe's hot path — this is
/// the mechanism behind "record raw samples, compute percentiles at the end" rather than computing
/// them inline per event. Nothing here is thread-safe; the probe's read loop is single-threaded by
/// design (see <see cref="ProbeSession"/>), so none is needed.
/// </para>
/// </remarks>
internal sealed class ReservoirSampler
{
    private readonly long[] _buffer;
    private readonly Random _random;
    private int _count;
    private long _seen;

    /// <param name="capacity">Maximum samples retained.</param>
    /// <param name="seed">
    /// Fixed rather than time-derived, so a percentile computed from a reservoir is reproducible
    /// given the same input stream — consistent with the rest of Phase 2's seeded-reproducibility
    /// discipline, even though this seed governs sampling rather than generation.
    /// </param>
    internal ReservoirSampler(int capacity, int seed = 0x5052_4F42) // "PROB"
    {
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(capacity, 0);
        _buffer = new long[capacity];
        _random = new Random(seed);
    }

    /// <summary>Total samples offered, including ones the reservoir did not keep.</summary>
    internal long TotalSeen => _seen;

    internal void Add(long value)
    {
        _seen++;

        if (_count < _buffer.Length)
        {
            _buffer[_count++] = value;
            return;
        }

        // Vitter's Algorithm R: the k-th element (k = _seen, 1-indexed) replaces a uniformly
        // random existing slot with probability capacity/k, which keeps every element seen so far
        // equally likely to be in the final sample.
        long slot = (long)(_random.NextDouble() * _seen);
        if (slot < _buffer.Length)
        {
            _buffer[slot] = value;
        }
    }

    /// <summary>Copies the samples collected so far, for percentile computation at the end of a run.</summary>
    internal long[] Snapshot()
    {
        long[] copy = new long[_count];
        Array.Copy(_buffer, copy, _count);
        return copy;
    }
}
