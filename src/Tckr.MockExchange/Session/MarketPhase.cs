namespace Tckr.MockExchange.Session;

/// <summary>
/// The stages of a trading day that the mock exchange models, in the order they occur.
/// </summary>
/// <remarks>
/// The set is deliberately coarse. Real venues distinguish far more states (opening cross,
/// volatility auctions, trade reporting windows), but Phase 2 only needs enough structure for the
/// emission rate to visibly change shape across a session &#8212; a burst at the open, a lull at
/// midday, a burst at the close. Anything finer would be micro-structure we cannot validate
/// against a real tape.
/// </remarks>
internal enum MarketPhase
{
    /// <summary>Outside session hours. No events are emitted.</summary>
    Closed = 0,

    /// <summary>Order entry is open but the book does not trade. A thin trickle of quotes.</summary>
    PreOpen = 1,

    /// <summary>The opening cross. The heaviest burst of the day.</summary>
    OpeningAuction = 2,

    /// <summary>Continuous trading before midday.</summary>
    ContinuousMorning = 3,

    /// <summary>The midday drop in activity.</summary>
    MiddayLull = 4,

    /// <summary>Continuous trading after midday.</summary>
    ContinuousAfternoon = 5,

    /// <summary>The closing cross. The second heaviest burst of the day.</summary>
    ClosingAuction = 6,
}
