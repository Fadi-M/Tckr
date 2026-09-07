namespace Tckr.MockExchange.Session;

/// <summary>
/// How <see cref="MarketSessionClock"/> maps wall-clock time onto <see cref="MarketPhase"/>.
/// </summary>
internal enum MarketSessionMode
{
    /// <summary>
    /// Always <see cref="MarketPhase.ContinuousMorning"/> at a multiplier of <c>1.0</c>.
    /// </summary>
    /// <remarks>
    /// The default, and the mode every benchmark runs in: a measurement whose target rate moves
    /// under it is not a measurement. Phase shaping is a demo and realism feature, not a
    /// throughput feature.
    /// </remarks>
    Continuous = 0,

    /// <summary>
    /// Phases follow real wall-clock time in the configured exchange time zone.
    /// </summary>
    Scheduled = 1,

    /// <summary>
    /// The whole session is compressed into a short repeating window so a demo shows every phase
    /// in a few minutes.
    /// </summary>
    CompressedDay = 2,
}
