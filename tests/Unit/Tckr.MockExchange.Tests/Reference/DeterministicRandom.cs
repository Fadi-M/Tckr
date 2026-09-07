namespace Tckr.MockExchange.Tests.Reference;

/// <summary>
/// A fixed-seed SplitMix64 stream, standing in for the generator's RNG (task 03).
/// </summary>
/// <remarks>
/// The distribution tests draw a million values, so a genuinely random source would make them
/// flaky at whatever tolerance is chosen. With a fixed seed the assertions are deterministic: a
/// failure means the alias table is wrong, not that the run was unlucky. SplitMix64 is used rather
/// than <see cref="Random"/> because <see cref="WeightedSymbolPicker.Next"/> splits the word into
/// two independent halves and therefore needs uniform quality across all 64 bits.
/// </remarks>
internal struct DeterministicRandom(ulong seed)
{
    private ulong _state = seed;

    internal ulong NextUInt64()
    {
        var z = _state += 0x9E37_79B9_7F4A_7C15UL;
        z = (z ^ (z >> 30)) * 0xBF58_476D_1CE4_E5B9UL;
        z = (z ^ (z >> 27)) * 0x94D0_49BB_1331_11EBUL;
        return z ^ (z >> 31);
    }
}
