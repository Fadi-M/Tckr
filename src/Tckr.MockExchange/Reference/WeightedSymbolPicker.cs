using System.Runtime.CompilerServices;

namespace Tckr.MockExchange.Reference;

/// <summary>
/// Picks a symbol index in proportion to a fixed weight vector, in O(1) with no allocation,
/// using Vose's alias method.
/// </summary>
/// <remarks>
/// <para>
/// The alias method turns an arbitrary discrete distribution into <c>n</c> equal-probability
/// buckets, each holding at most two outcomes. A pick is therefore: choose a bucket uniformly,
/// then flip one biased coin. Two array reads, one compare, no loop &#8212; against O(log n) and a
/// data-dependent branch chain for cumulative-weight binary search.
/// </para>
/// <para>
/// At 25,000 picks/sec neither is slow. The reason to prefer the alias table is that its cost is
/// <em>constant and independent of the distribution</em>: a skewed universe does not make picks
/// cheaper for hot symbols and dearer for cold ones, so the generator's per-event cost does not
/// correlate with which symbol it happens to produce. That keeps Phase 4's latency histograms
/// honest.
/// </para>
/// </remarks>
internal sealed class WeightedSymbolPicker
{
    /// <summary>The alias partner for each bucket, or the bucket itself when it is unsplit.</summary>
    private readonly int[] _alias;

    /// <summary>
    /// Per-bucket coin threshold, as a probability scaled into <see cref="uint"/> range: the
    /// bucket's own outcome is taken when the coin draw is below it.
    /// </summary>
    /// <remarks>
    /// Fixed-point rather than <see cref="double"/> so the hot path compares two integers and the
    /// result cannot drift with floating-point rounding mode. Resolution is 2^-32, which caps the
    /// per-bucket probability error at ~2.3e-10.
    /// </remarks>
    private readonly uint[] _threshold;

    private readonly int _count;

    /// <summary>Builds the alias table. Allocates; intended to run once, at startup.</summary>
    /// <param name="weights">
    /// Relative weights, one per symbol index. Need not sum to one; they are normalised here.
    /// Every entry must be finite and greater than zero, so that every symbol keeps a non-zero
    /// chance of appearing on the tape.
    /// </param>
    /// <exception cref="ArgumentException">
    /// <paramref name="weights"/> is empty, or contains a non-positive or non-finite value.
    /// </exception>
    internal WeightedSymbolPicker(ReadOnlySpan<double> weights)
    {
        if (weights.IsEmpty)
        {
            throw new ArgumentException("A weighted picker needs at least one weight.", nameof(weights));
        }

        var total = 0d;
        for (var i = 0; i < weights.Length; i++)
        {
            var weight = weights[i];
            if (weight <= 0d || double.IsNaN(weight) || double.IsInfinity(weight))
            {
                throw new ArgumentException(
                    $"Weight at index {i} is {weight}; every weight must be a finite value greater than zero.",
                    nameof(weights));
            }

            total += weight;
        }

        _count = weights.Length;
        _alias = new int[_count];
        _threshold = new uint[_count];

        // Scale so that the mean scaled weight is exactly 1: a bucket is "small" below 1 and
        // "large" above, and Vose's construction pairs one of each until none are left.
        var scaled = new double[_count];
        var scale = _count / total;
        for (var i = 0; i < _count; i++)
        {
            scaled[i] = weights[i] * scale;
        }

        // Two stacks carved out of one buffer: small grows up from the bottom, large down from
        // the top. They can never overlap because together they hold at most n entries.
        var work = new int[_count];
        var smallTop = 0;
        var largeTop = _count;

        for (var i = _count - 1; i >= 0; i--)
        {
            if (scaled[i] < 1d)
            {
                work[smallTop++] = i;
            }
            else
            {
                work[--largeTop] = i;
            }
        }

        while (smallTop > 0 && largeTop < _count)
        {
            var small = work[--smallTop];
            var large = work[largeTop++];

            _threshold[small] = ToThreshold(scaled[small]);
            _alias[small] = large;

            // The large bucket donates exactly the shortfall of the small one.
            scaled[large] -= 1d - scaled[small];

            if (scaled[large] < 1d)
            {
                work[smallTop++] = large;
            }
            else
            {
                work[--largeTop] = large;
            }
        }

        // Whatever is left is 1.0 up to floating-point residue: give it the whole bucket and
        // alias it to itself, so even a mis-rounded coin flip lands on the same outcome.
        while (largeTop < _count)
        {
            var large = work[largeTop++];
            _threshold[large] = uint.MaxValue;
            _alias[large] = large;
        }

        while (smallTop > 0)
        {
            var small = work[--smallTop];
            _threshold[small] = uint.MaxValue;
            _alias[small] = small;
        }
    }

    /// <summary>Number of symbol indices this picker can return.</summary>
    internal int Count => _count;

    /// <summary>Returns a symbol index drawn according to the configured weights.</summary>
    /// <param name="random">
    /// A raw, uniformly distributed 64-bit draw from the caller's generator. The picker
    /// deliberately does not own an RNG: task 03 owns seeding, so that a seed reproduces a tape
    /// end to end and the picker cannot quietly introduce a second, unseeded source of randomness.
    /// </param>
    /// <remarks>
    /// The high 32 bits choose the bucket and the low 32 bits are the coin, so the two draws come
    /// from disjoint bits and are independent for any generator with uniform 64-bit output
    /// (xoshiro256**, PCG, SplitMix64). Do not feed this the raw output of a generator with weak
    /// low bits, such as a plain LCG.
    /// </remarks>
    /// <returns>An index in <c>[0, <see cref="Count"/>)</c>.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal int Next(ulong random)
    {
        // Lemire's multiply-shift: uniform over [0, count) with bias below count / 2^32, and one
        // multiply instead of a division.
        var bucket = (int)((uint)(random >> 32) * (ulong)(uint)_count >> 32);
        return (uint)random < _threshold[bucket] ? bucket : _alias[bucket];
    }

    /// <summary>Scales a probability in [0, 1] into the <see cref="uint"/> coin range.</summary>
    private static uint ToThreshold(double probability)
    {
        if (probability <= 0d)
        {
            return 0u;
        }

        var scaled = Math.Round(probability * 4_294_967_296d);
        return scaled >= uint.MaxValue ? uint.MaxValue : (uint)scaled;
    }
}
