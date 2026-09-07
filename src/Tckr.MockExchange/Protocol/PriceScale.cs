namespace Tckr.MockExchange.Protocol;

/// <summary>
/// Converts between human-facing <see cref="decimal"/> prices and the fixed-point
/// <see cref="long"/> form that travels on the wire.
/// </summary>
/// <remarks>
/// Binary floating point cannot represent ordinary tick values exactly &#8212; <c>85.10</c> is not
/// a <see cref="double"/> &#8212; so a feed that carries prices as floats disagrees with the
/// exchange's own printed tape at the last decimal, intermittently, and only under load. Scaling
/// to an integer removes the question entirely. Four implied decimals covers every tick size in
/// the Phase 2 symbol universe with room to spare while keeping the whole price in 8 bytes.
/// </remarks>
internal static class PriceScale
{
    /// <summary>Implied decimal places carried by a scaled price.</summary>
    internal const int Decimals = 4;

    /// <summary>Multiplier applied to a decimal price to reach its scaled form.</summary>
    internal const long Factor = 10_000;

    /// <summary>
    /// Scales <paramref name="price"/> for the wire, rounding half away from zero.
    /// </summary>
    /// <remarks>
    /// Away-from-zero rather than the .NET default (banker's rounding): exchanges round half up,
    /// and a feed whose rounding rule differs from the venue's produces a tape that cannot be
    /// reconciled against the venue's.
    /// </remarks>
    /// <exception cref="OverflowException">
    /// The scaled value does not fit in an <see cref="long"/>.
    /// </exception>
    internal static long ToScaled(decimal price)
    {
        decimal scaled = Math.Round(price * Factor, 0, MidpointRounding.AwayFromZero);

        if (scaled < long.MinValue || scaled > long.MaxValue)
        {
            throw new OverflowException(
                $"Price {price} scales to {scaled}, which does not fit in a 64-bit scaled price.");
        }

        return (long)scaled;
    }

    /// <summary>Restores the decimal price from its scaled wire form.</summary>
    internal static decimal FromScaled(long scaled) => (decimal)scaled / Factor;
}
