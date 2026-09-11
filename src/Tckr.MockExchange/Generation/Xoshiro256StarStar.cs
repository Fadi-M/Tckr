using System.Numerics;
using System.Runtime.CompilerServices;

namespace Tckr.MockExchange.Generation;

/// <summary>
/// xoshiro256** &#8212; the generation engine's single source of randomness.
/// </summary>
/// <remarks>
/// <para>
/// <see cref="Random"/> is the wrong tool here for two independent reasons. Its unseeded form
/// (<see cref="Random.Shared"/>) cannot be seeded at all, and its seeded form is documented as an
/// implementation detail: the algorithm changed between .NET Framework and .NET Core and may
/// change again, so a tape captured today would not reproduce on tomorrow's runtime. Reproducible
/// benchmarks across Phases 4, 9, 15 and 16 are the whole reason this component is seedable, and
/// a seed that only reproduces on one runtime version buys none of it.
/// </para>
/// <para>
/// xoshiro256** is five lines of state transition, has a 2^256 period, and &#8212; the property
/// that actually matters downstream &#8212; is uniform in <em>every</em> bit of its output. The
/// hot path leans on that: a single 64-bit draw is sliced into independent fields (see
/// <see cref="RandomWalkGenerator"/>), and <c>WeightedSymbolPicker.Next</c> splits one draw into a
/// bucket selector and a coin. A generator with weak low bits, such as a plain LCG, would make
/// both silently wrong rather than visibly broken.
/// </para>
/// <para>
/// <b>Not thread-safe, by design.</b> The state transition is four unsynchronised reads and four
/// unsynchronised writes; two threads sharing an instance do not merely interleave, they can drive
/// the state into a shorter cycle. One instance belongs to one generation loop. The mock exchange
/// runs a single generation loop by construction (task 06), so this costs nothing; if that ever
/// changes, give each loop its own instance and its own seed rather than locking this one.
/// </para>
/// </remarks>
internal sealed class Xoshiro256StarStar
{
    /// <summary>SplitMix64's golden-ratio increment.</summary>
    private const ulong SplitMixGamma = 0x9E37_79B9_7F4A_7C15UL;

    /// <summary>Reciprocal of 2^53, the number of distinct doubles in [0, 1) with full mantissa.</summary>
    private const double TwoPowMinus53 = 1.0 / 9_007_199_254_740_992.0;

    private ulong _s0;
    private ulong _s1;
    private ulong _s2;
    private ulong _s3;

    /// <summary>
    /// Expands <paramref name="seed"/> into the four-word state with SplitMix64.
    /// </summary>
    /// <remarks>
    /// Seeding xoshiro by dropping the seed into one word and zeroing the rest is the classic
    /// mistake: the state is then almost all zeros, and the generator needs thousands of draws
    /// before the output looks random at all. SplitMix64 is the author's prescribed remedy &#8212;
    /// it is a full-period bijection over 64 bits, so a run seed of <c>0</c> and a run seed of
    /// <c>1</c> produce four state words with no visible relationship, and therefore two tapes
    /// with no visible relationship from the first event.
    /// </remarks>
    internal Xoshiro256StarStar(ulong seed)
    {
        ulong mixer = seed;
        _s0 = NextSplitMix(ref mixer);
        _s1 = NextSplitMix(ref mixer);
        _s2 = NextSplitMix(ref mixer);
        _s3 = NextSplitMix(ref mixer);

        // The all-zero state is xoshiro's single fixed point: it emits zero for ever. SplitMix64
        // would have to return zero four times running to produce it, which will not happen, but
        // the failure mode is a silently constant tape rather than an exception, so it is worth
        // one branch at construction to make it impossible rather than merely improbable.
        if ((_s0 | _s1 | _s2 | _s3) == 0)
        {
            _s3 = SplitMixGamma;
        }
    }

    /// <summary>Advances the state and returns the next uniform 64-bit draw.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal ulong NextUInt64()
    {
        // The "**" scrambler: the returned value is derived from the state, never the state
        // itself, so the linear structure of the transition does not leak into the output.
        ulong result = BitOperations.RotateLeft(_s1 * 5, 7) * 9;

        ulong t = _s1 << 17;

        _s2 ^= _s0;
        _s3 ^= _s1;
        _s1 ^= _s2;
        _s0 ^= _s3;
        _s2 ^= t;
        _s3 = BitOperations.RotateLeft(_s3, 45);

        return result;
    }

    /// <summary>A uniform <see cref="double"/> in <c>[0, 1)</c>.</summary>
    /// <remarks>
    /// Built from the top 53 bits, which is every bit a <see cref="double"/> can hold without
    /// rounding. Multiplying a full 64-bit draw by 2^-64 instead would round the top of the range
    /// up to exactly <c>1.0</c>, which every caller that writes <c>x &lt; p</c> then gets wrong at
    /// the boundary. Used for setup and for tests; probabilities on the hot path are compared in
    /// fixed point, so no draw here is ever converted back into a price.
    /// </remarks>
    internal double NextDouble() => (NextUInt64() >> 11) * TwoPowMinus53;

    /// <summary>
    /// A uniform <see cref="int"/> in <c>[0, <paramref name="exclusiveMax"/>)</c>, with no modulo
    /// bias.
    /// </summary>
    /// <remarks>
    /// Lemire's multiply-shift with the rejection step included, so the result is
    /// <em>exactly</em> uniform rather than uniform to within 2^-32. The rejection loop makes the
    /// cost data-dependent, which is why the hot path in <see cref="RandomWalkGenerator"/> uses
    /// the same multiply-shift <em>without</em> rejection: over the tiny ranges it draws (a tick
    /// move in [0, 3], a spread in [1, 4]) the residual bias is below 1e-9 and constant time is
    /// worth more than the last nine decimal places. This method exists for setup and for tests,
    /// where uniformity is the property under test and the cost is irrelevant.
    /// </remarks>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="exclusiveMax"/> is not positive.</exception>
    internal int NextInt(int exclusiveMax)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(exclusiveMax);

        uint range = (uint)exclusiveMax;
        ulong product = (uint)NextUInt64() * (ulong)range;
        uint low = (uint)product;

        if (low < range)
        {
            // 2^32 is not a multiple of `range`, so the last partial block of the 32-bit draw
            // space would over-represent the first few outcomes. Reject draws landing in it.
            uint threshold = (uint)-(int)range % range;
            while (low < threshold)
            {
                product = (uint)NextUInt64() * (ulong)range;
                low = (uint)product;
            }
        }

        return (int)(product >> 32);
    }

    /// <summary>One SplitMix64 step, used only to expand the seed.</summary>
    private static ulong NextSplitMix(ref ulong state)
    {
        ulong z = state += SplitMixGamma;
        z = (z ^ (z >> 30)) * 0xBF58_476D_1CE4_E5B9UL;
        z = (z ^ (z >> 27)) * 0x94D0_49BB_1331_11EBUL;
        return z ^ (z >> 31);
    }
}
