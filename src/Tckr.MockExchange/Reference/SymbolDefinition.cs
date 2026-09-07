using System.Text.RegularExpressions;
using Tckr.MockExchange.Protocol;

namespace Tckr.MockExchange.Reference;

/// <summary>
/// Static reference data for one tradable instrument.
/// </summary>
/// <remarks>
/// This is load-time data, not hot-path data. The generation loop (task 03) works with the
/// <see cref="int"/> index into <see cref="SymbolUniverse"/> and with <see cref="Packed"/>; it
/// never reads <see cref="Symbol"/> or <see cref="Name"/>, both of which are strings and would
/// put a pointer chase on a path that runs 25,000 times a second.
/// </remarks>
internal sealed partial record SymbolDefinition
{
    /// <summary>
    /// Listing rule for a symbol in this universe: one to eight uppercase ASCII letters or
    /// digits.
    /// </summary>
    /// <remarks>
    /// Deliberately stricter than the wire codec, which accepts any printable non-space ASCII so
    /// that tickers such as <c>BRK.B</c> can travel. Framing decides what can be encoded; the
    /// universe decides what this exchange is willing to list.
    /// </remarks>
    internal const string SymbolPattern = "^[A-Z0-9]{1,8}$";

    /// <summary>Exchange ticker. Matches <see cref="SymbolPattern"/>.</summary>
    internal required string Symbol { get; init; }

    /// <summary>Human-readable instrument name, for logs and diagnostics only.</summary>
    internal required string Name { get; init; }

    /// <summary>Opening reference price. The random walk (task 03) starts here.</summary>
    internal required decimal ReferencePrice { get; init; }

    /// <summary>Minimum price increment. Prices on the tape are multiples of this.</summary>
    internal required decimal TickSize { get; init; }

    /// <summary>Typical trade size unit; generated quantities are multiples of it.</summary>
    internal required int LotSize { get; init; }

    /// <summary>
    /// Relative activity share. Not a probability: <see cref="SymbolUniverse"/> normalises
    /// weights across the whole universe at load time.
    /// </summary>
    internal required double Weight { get; init; }

    /// <summary>
    /// <see cref="Symbol"/> in its packed wire form, converted once at load time.
    /// </summary>
    /// <remarks>
    /// Populated by <see cref="WithPackedSymbol"/> after validation, so the generator never pays
    /// for an ASCII conversion or a string allocation per event. A default-constructed
    /// <see cref="Symbol8"/> here means the definition never went through
    /// <see cref="SymbolUniverse"/>.
    /// </remarks>
    internal Symbol8 Packed { get; private init; }

    /// <summary>Returns a copy with <see cref="Packed"/> derived from <see cref="Symbol"/>.</summary>
    internal SymbolDefinition WithPackedSymbol() => this with { Packed = Symbol8.FromAscii(Symbol) };

    /// <summary>
    /// Throws if any field is unusable. A malformed universe must fail at startup, not at
    /// event 4,000,000 on a benchmark run.
    /// </summary>
    /// <param name="origin">Where the definition came from, for the exception message.</param>
    /// <exception cref="InvalidDataException">A field is missing, malformed or non-positive.</exception>
    internal void Validate(string origin)
    {
        if (!SymbolRegex().IsMatch(Symbol))
        {
            throw new InvalidDataException(
                $"{origin}: symbol '{Symbol}' is not a valid ticker. " +
                $"Symbols must match {SymbolPattern} (1-8 uppercase ASCII letters or digits).");
        }

        if (string.IsNullOrWhiteSpace(Name))
        {
            throw new InvalidDataException($"{origin}: symbol '{Symbol}' has an empty name.");
        }

        if (ReferencePrice <= 0m)
        {
            throw new InvalidDataException(
                $"{origin}: symbol '{Symbol}' has referencePrice {ReferencePrice}; it must be greater than zero.");
        }

        if (TickSize <= 0m)
        {
            throw new InvalidDataException(
                $"{origin}: symbol '{Symbol}' has tickSize {TickSize}; it must be greater than zero.");
        }

        if (LotSize <= 0)
        {
            throw new InvalidDataException(
                $"{origin}: symbol '{Symbol}' has lotSize {LotSize}; it must be greater than zero.");
        }

        if (Weight <= 0d || double.IsNaN(Weight) || double.IsInfinity(Weight))
        {
            throw new InvalidDataException(
                $"{origin}: symbol '{Symbol}' has weight {Weight}; it must be a finite value greater than zero. " +
                "A zero-weight symbol would never trade, which is a data error rather than a market condition.");
        }
    }

    [GeneratedRegex(SymbolPattern, RegexOptions.CultureInvariant)]
    private static partial Regex SymbolRegex();
}
