namespace Tckr.MockExchange.Generation;

/// <summary>
/// The walking state of one instrument: where its price is, where it is anchored, and the
/// pre-computed constants the walk needs so that no step costs a division.
/// </summary>
/// <remarks>
/// <para>
/// A mutable struct held in a pre-allocated array indexed by symbol index, never a dictionary and
/// never boxed. The generator mutates it through <c>ref</c>, so an event is a handful of loads and
/// stores inside one cache line's neighbourhood rather than a hash, a pointer chase and a
/// write barrier.
/// </para>
/// <para>
/// Every price field is scaled (see <c>PriceScale</c>) and every one of them is an exact multiple
/// of <see cref="TickSizeScaled"/>. That invariant is established once, in
/// <see cref="RandomWalkGenerator.ResetSession"/>, and then preserved for free: the walk only ever
/// adds or subtracts whole ticks, and the band bounds it clamps against are themselves on the tick
/// grid. Nothing on the hot path rounds, so nothing on the hot path can round wrongly.
/// </para>
/// </remarks>
internal struct SymbolState
{
    /// <summary>
    /// The random walk's current position &#8212; the notional mid, from which the quotes and the
    /// trade print are derived.
    /// </summary>
    /// <remarks>
    /// Separate from <see cref="LastTradePriceScaled"/> on purpose. If the walk resumed from the
    /// last <em>printed</em> trade, each step would carry the print's own offset inside the spread
    /// as well as the tick move, and the per-symbol price could travel further between consecutive
    /// events than <c>MaxTickMove</c> allows. Continuity is the property Phase 3 onward asserts
    /// per-symbol ordering against, so it is bounded here rather than approximately true.
    /// </remarks>
    internal long MidPriceScaled;

    /// <summary>The most recent trade print, or the opening price if the symbol has not traded.</summary>
    internal long LastTradePriceScaled;

    /// <summary>Current top-of-book bid. Strictly below <see cref="AskScaled"/>.</summary>
    internal long BidScaled;

    /// <summary>Current top-of-book ask.</summary>
    internal long AskScaled;

    /// <summary>Session-open anchor: the price mean reversion pulls towards and the band centres on.</summary>
    internal long ReferencePriceScaled;

    /// <summary>Lowest price the symbol may print this session. On the tick grid.</summary>
    internal long LowerBandScaled;

    /// <summary>Highest price the symbol may print this session. On the tick grid.</summary>
    internal long UpperBandScaled;

    /// <summary>
    /// Half the band width &#8212; the deviation at which mean reversion reaches full strength.
    /// </summary>
    internal long ReversionSpanScaled;

    /// <summary>
    /// <c>2^63 / <see cref="ReversionSpanScaled"/></c>, so the walk can express
    /// <c>|deviation| / span</c> as a shift-and-multiply instead of a 64-bit division.
    /// </summary>
    /// <remarks>
    /// A hardware 64-bit divide is tens of cycles and, unlike a multiply, is not pipelined; one
    /// per event would be the single most expensive instruction in the loop. The deviation is
    /// bounded by the span, so the product is bounded by 2^63 and cannot overflow.
    /// </remarks>
    internal ulong ReversionMultiplier;

    /// <summary>Minimum price increment, scaled. Every price in this struct is a multiple of it.</summary>
    internal long TickSizeScaled;

    /// <summary>Share count one lot represents; generated quantities are multiples of it.</summary>
    internal int LotSize;

    /// <summary>Trade prints emitted for this symbol since the last session reset. Diagnostics only.</summary>
    internal uint TradesToday;
}
