namespace Tckr.MockExchange.Session;

// TODO(task-06): this file is a placeholder owned by task 04 only until task 06 exists.
// Task 06 owns src/Tckr.MockExchange/Options/**. Move this file to
// Options/MarketSessionOptions.cs verbatim and either keep the namespace
// `Tckr.MockExchange.Session` (nothing else changes) or change it to
// `Tckr.MockExchange.Options` and add a `using Tckr.MockExchange.Options;` to
// Session/MarketSessionClock.cs. Do not change the property names, types or defaults without
// updating MarketSessionClockTests.
//
// Binding note: the class is internal (per the Phase 2 conventions) but its properties are
// public on purpose. Microsoft.Extensions.Configuration's reflection binder ignores non-public
// properties unless BindNonPublicProperties is set, so internal properties here would bind to
// silence rather than to an error.

/// <summary>
/// Configuration for <see cref="MarketSessionClock"/>: which mode the session runs in, the
/// phase schedule, and the ceiling that stops a burst multiplier asking for a rate the box
/// cannot serve.
/// </summary>
internal sealed class MarketSessionOptions
{
    /// <summary>Configuration section this binds from.</summary>
    internal const string SectionName = "MockExchange:MarketSession";

    /// <summary>How wall-clock time maps onto phases. Defaults to <see cref="MarketSessionMode.Continuous"/>.</summary>
    public MarketSessionMode Mode { get; set; } = MarketSessionMode.Continuous;

    /// <summary>
    /// IANA (or Windows) identifier for the exchange's local time zone, used by
    /// <see cref="MarketSessionMode.Scheduled"/>.
    /// </summary>
    /// <remarks>
    /// Defaults to UTC rather than a real venue's zone so that the default configuration behaves
    /// identically on every machine and in every CI region. A benchmark whose phase schedule
    /// depends on the runner's locale is not reproducible.
    /// </remarks>
    public string TimeZone { get; set; } = "UTC";

    /// <summary>
    /// Length of one <see cref="MarketSessionMode.CompressedDay"/> cycle, in minutes.
    /// </summary>
    public int CompressedDurationMinutes { get; set; } = 5;

    /// <summary>
    /// Fraction of a <see cref="MarketSessionMode.CompressedDay"/> cycle spent
    /// <see cref="MarketPhase.Closed"/> before the compressed session begins.
    /// </summary>
    /// <remarks>
    /// Without a closed segment a compressed day never leaves the session window, so a demo never
    /// shows the phase that matters most for a consumer: the one where the tape stops. Set to
    /// <c>0</c> to give the whole cycle to the session.
    /// </remarks>
    public double CompressedClosedFraction { get; set; } = 0.10;

    /// <summary>
    /// Ceiling applied by <see cref="MarketSessionClock.EffectiveEventsPerSecond"/> after the
    /// phase multiplier.
    /// </summary>
    public double MaxEventsPerSecond { get; set; } = 100_000;

    /// <summary>The phase schedule in exchange local time. Windows outside it are <see cref="MarketPhase.Closed"/>.</summary>
    public IList<MarketPhaseWindow> Phases { get; set; } = CreateDefaultPhases();

    /// <summary>The default schedule: a five-hour session with an opening and a closing burst.</summary>
    internal static List<MarketPhaseWindow> CreateDefaultPhases() =>
    [
        new() { Phase = MarketPhase.PreOpen,             Start = new(9, 30, 0),  End = new(10, 0, 0),  RateMultiplier = 0.10 },
        new() { Phase = MarketPhase.OpeningAuction,      Start = new(10, 0, 0),  End = new(10, 5, 0),  RateMultiplier = 3.00 },
        new() { Phase = MarketPhase.ContinuousMorning,   Start = new(10, 5, 0),  End = new(12, 0, 0),  RateMultiplier = 1.20 },
        new() { Phase = MarketPhase.MiddayLull,          Start = new(12, 0, 0),  End = new(13, 30, 0), RateMultiplier = 0.60 },
        new() { Phase = MarketPhase.ContinuousAfternoon, Start = new(13, 30, 0), End = new(14, 15, 0), RateMultiplier = 1.00 },
        new() { Phase = MarketPhase.ClosingAuction,      Start = new(14, 15, 0), End = new(14, 30, 0), RateMultiplier = 2.50 },
    ];
}

/// <summary>One entry in the phase schedule: a half-open local-time window and its rate multiplier.</summary>
internal sealed class MarketPhaseWindow
{
    /// <summary>The phase in force during the window.</summary>
    public MarketPhase Phase { get; set; }

    /// <summary>Inclusive start, as a time of day in exchange local time.</summary>
    public TimeSpan Start { get; set; }

    /// <summary>Exclusive end, as a time of day in exchange local time.</summary>
    public TimeSpan End { get; set; }

    /// <summary>Multiplier applied to the configured base rate while this phase is in force.</summary>
    public double RateMultiplier { get; set; } = 1.0;
}
