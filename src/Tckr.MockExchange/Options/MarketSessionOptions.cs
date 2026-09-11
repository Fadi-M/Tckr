using System.ComponentModel.DataAnnotations;
using Tckr.MockExchange.Session;

namespace Tckr.MockExchange.Options;

// Handed over from task 04, which owned this file as a placeholder under Session/. Moved verbatim
// apart from the namespace, the binding attributes, and the three pacing properties task 06 added
// at the end (BaseEventsPerSecond, BatchIntervalMs, MaxCatchUpBatches) — the publisher loop and
// the rate governor are configured from the same section as the phase schedule that drives them.
// Property names, types and defaults of everything task 04 specified are unchanged, because
// MarketSessionClockTests asserts them.
//
// Binding note: the class is internal (per the Phase 2 conventions) but its properties are
// public on purpose. Microsoft.Extensions.Configuration's reflection binder ignores non-public
// properties unless BindNonPublicProperties is set, so internal properties here would bind to
// silence rather than to an error. Phases is IList<T> rather than IReadOnlyList<T> for the same
// reason: the binder can populate the first and not the second.

/// <summary>
/// Configuration for <see cref="MarketSessionClock"/>: which mode the session runs in, the
/// phase schedule, and the ceiling that stops a burst multiplier asking for a rate the box
/// cannot serve.
/// </summary>
internal sealed class MarketSessionOptions
{
    /// <summary>Configuration section this binds from.</summary>
    internal const string SectionName = $"{MockExchangeOptions.SectionName}:Session";

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
    [Required(AllowEmptyStrings = false)]
    public string TimeZone { get; set; } = "UTC";

    /// <summary>
    /// Length of one <see cref="MarketSessionMode.CompressedDay"/> cycle, in minutes.
    /// </summary>
    [Range(1, 1_440)]
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
    [Range(0d, 0.9d)]
    public double CompressedClosedFraction { get; set; } = 0.10;

    /// <summary>
    /// Ceiling applied by <see cref="MarketSessionClock.EffectiveEventsPerSecond"/> after the
    /// phase multiplier.
    /// </summary>
    [Range(1d, 100_000_000d)]
    public double MaxEventsPerSecond { get; set; } = 100_000;

    /// <summary>
    /// The rate the exchange paces to before any phase multiplier is applied, in events/sec.
    /// </summary>
    /// <remarks>
    /// This is the number a benchmark quotes as its target, and the one
    /// <see cref="MarketSessionClock.EffectiveEventsPerSecond"/> is handed each batch. The Phase 2
    /// target is 25,000; <c>appsettings.Development.json</c> drops it so <c>dotnet run</c> on a
    /// laptop is quiet.
    /// </remarks>
    [Range(1d, 100_000_000d)]
    public double BaseEventsPerSecond { get; set; } = 25_000;

    /// <summary>
    /// How often the publisher loop wakes to emit a batch, in milliseconds.
    /// </summary>
    /// <remarks>
    /// The trade between syscall pressure and burstiness. At the default 5 ms and 25,000/sec a
    /// batch is 125 records — one socket write per session per batch instead of 25,000 of them,
    /// and a consumer never waits more than 5 ms for the tape to move.
    /// </remarks>
    [Range(1, 100)]
    public int BatchIntervalMs { get; set; } = RateGovernor.DefaultBatchIntervalMs;

    /// <summary>
    /// Batches worth of backlog the governor may make up in one batch before abandoning the
    /// schedule.
    /// </summary>
    /// <remarks>
    /// A cap rather than a knob: emitting an unbounded backlog turns a GC pause into a burst and
    /// the burst into a longer pause. Any run whose
    /// <see cref="RateGovernor.CatchUpBatchesDropped"/> is non-zero has an invalid achieved-rate
    /// claim, which is why it is reported rather than silently absorbed.
    /// </remarks>
    [Range(0, 1_000)]
    public int MaxCatchUpBatches { get; set; } = RateGovernor.DefaultMaxCatchUpBatches;

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
