using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace Tckr.MockExchange.Session;

/// <summary>
/// Shapes the emission rate across a trading day: resolves the current
/// <see cref="MarketPhase"/> and turns a configured base rate into the rate that phase asks for.
/// </summary>
/// <remarks>
/// <para>
/// The clock only decides <em>what rate to ask for</em>. <see cref="RateGovernor"/> decides
/// <em>when</em> and <em>how many</em>. Keeping the two apart is what lets the pacing be tested
/// for accuracy without a session, and the session be tested for shape without waiting for
/// lunchtime.
/// </para>
/// <para>
/// Deliberately not modelled: holidays, half-days, weekends, and auction micro-structure. The
/// component exists to make the tape change shape, not to be a venue calendar; a half-accurate
/// calendar is worse than an obviously synthetic one because it invites trust it has not earned.
/// </para>
/// <para>
/// Not thread-safe. <see cref="Advance"/> is called from the generation loop, which is the only
/// writer; <see cref="PhaseChanged"/> handlers run inline on that loop and must be cheap.
/// </para>
/// </remarks>
internal sealed class MarketSessionClock
{
    private readonly MarketSessionOptions _options;
    private readonly MarketPhaseWindow[] _windows;
    private readonly TimeZoneInfo _timeZone;
    private readonly ILogger _logger;

    private readonly TimeSpan _sessionStart;
    private readonly TimeSpan _sessionSpan;
    private readonly DateTimeOffset _anchor;
    private readonly long _cycleTicks;
    private readonly long _closedTicks;

    private bool _clampLogged;

    /// <summary>Creates a clock and resolves the phase in force at the current time.</summary>
    /// <param name="options">Mode, schedule, and the rate ceiling.</param>
    /// <param name="timeProvider">
    /// Clock source. Used to anchor a <see cref="MarketSessionMode.CompressedDay"/> cycle and to
    /// resolve the starting phase; <see cref="Advance"/> takes its own timestamp thereafter.
    /// </param>
    /// <param name="logger">Optional; used for the clamp and time-zone warnings.</param>
    internal MarketSessionClock(
        MarketSessionOptions options,
        TimeProvider? timeProvider = null,
        ILogger<MarketSessionClock>? logger = null)
    {
        ArgumentNullException.ThrowIfNull(options);

        _options = options;
        _logger = logger ?? NullLogger<MarketSessionClock>.Instance;
        _windows = [.. (options.Phases ?? []).OrderBy(w => w.Start)];
        _timeZone = ResolveTimeZone(options.TimeZone, _logger);

        if (_windows.Length > 0)
        {
            _sessionStart = _windows[0].Start;
            _sessionSpan = _windows.Max(w => w.End) - _sessionStart;
        }

        TimeSpan cycle = TimeSpan.FromMinutes(Math.Max(options.CompressedDurationMinutes, 1));
        _cycleTicks = cycle.Ticks;
        double closedFraction = Math.Clamp(options.CompressedClosedFraction, 0, 0.9);
        _closedTicks = (long)(_cycleTicks * closedFraction);

        _anchor = (timeProvider ?? TimeProvider.System).GetUtcNow();

        (CurrentPhase, CurrentRateMultiplier) = Resolve(_anchor);
    }

    /// <summary>The phase in force as of the last <see cref="Advance"/>.</summary>
    internal MarketPhase CurrentPhase { get; private set; }

    /// <summary>The multiplier applied to the base rate in the current phase.</summary>
    internal double CurrentRateMultiplier { get; private set; }

    /// <summary>
    /// Raised when <see cref="Advance"/> moves the session into a different phase, with the
    /// previous phase first and the new phase second.
    /// </summary>
    /// <remarks>
    /// A single event reports where the session <em>is</em>, not every phase it passed through. A
    /// jump wide enough to skip a phase means the loop was stalled for the whole of that phase,
    /// which is a fault to be seen rather than a transition to be replayed.
    /// </remarks>
    internal event Action<MarketPhase, MarketPhase>? PhaseChanged;

    /// <summary>Moves the session to <paramref name="now"/>, raising <see cref="PhaseChanged"/> if the phase changed.</summary>
    internal void Advance(DateTimeOffset now)
    {
        (MarketPhase phase, double multiplier) = Resolve(now);

        CurrentRateMultiplier = multiplier;

        if (phase == CurrentPhase)
        {
            return;
        }

        MarketPhase previous = CurrentPhase;
        CurrentPhase = phase;
        _clampLogged = false;
        PhaseChanged?.Invoke(previous, phase);
    }

    /// <summary>
    /// Applies the current phase multiplier to <paramref name="baseRate"/>, clamped to
    /// <see cref="MarketSessionOptions.MaxEventsPerSecond"/>.
    /// </summary>
    /// <remarks>
    /// The clamp is logged once per phase. Silently capping is how a benchmark ends up measuring
    /// the wrong thing: the run reports the target it asked for while the exchange served a
    /// different one, and the gap shows up later as an unexplained latency result.
    /// </remarks>
    internal double EffectiveEventsPerSecond(double baseRate)
    {
        if (double.IsNaN(baseRate) || baseRate <= 0)
        {
            return 0;
        }

        double requested = baseRate * CurrentRateMultiplier;

        if (requested > _options.MaxEventsPerSecond)
        {
            if (!_clampLogged)
            {
                _clampLogged = true;
                _logger.LogWarning(
                    "Phase {MarketPhase} asks for {RequestedEventsPerSecond:F0} events/sec ({BaseEventsPerSecond:F0} x {RateMultiplier}), clamped to {MaxEventsPerSecond:F0}. The achieved rate for this phase will be below the configured multiplier.",
                    CurrentPhase, requested, baseRate, CurrentRateMultiplier, _options.MaxEventsPerSecond);
            }

            return _options.MaxEventsPerSecond;
        }

        return requested < 0 ? 0 : requested;
    }

    private (MarketPhase Phase, double Multiplier) Resolve(DateTimeOffset now) => _options.Mode switch
    {
        MarketSessionMode.Continuous => (MarketPhase.ContinuousMorning, 1.0),
        MarketSessionMode.CompressedDay => LookUp(CompressedTimeOfDay(now)),
        _ => LookUp(TimeZoneInfo.ConvertTime(now, _timeZone).TimeOfDay),
    };

    /// <summary>
    /// Maps <paramref name="now"/> onto a point in the compressed cycle: a leading
    /// <see cref="MarketPhase.Closed"/> segment, then the whole session span linearly compressed
    /// into what remains. Cycles repeat from the anchor taken at construction.
    /// </summary>
    private TimeSpan CompressedTimeOfDay(DateTimeOffset now)
    {
        long elapsed = (now - _anchor).Ticks;
        long position = elapsed % _cycleTicks;
        if (position < 0)
        {
            position += _cycleTicks;
        }

        if (position < _closedTicks)
        {
            // Anywhere outside the schedule reads as Closed; one tick before the session opens is
            // the least surprising choice.
            return _sessionStart - TimeSpan.FromTicks(1);
        }

        double through = (position - _closedTicks) / (double)(_cycleTicks - _closedTicks);
        return _sessionStart + TimeSpan.FromTicks((long)(through * _sessionSpan.Ticks));
    }

    private (MarketPhase Phase, double Multiplier) LookUp(TimeSpan timeOfDay)
    {
        foreach (MarketPhaseWindow window in _windows)
        {
            if (timeOfDay >= window.Start && timeOfDay < window.End)
            {
                return (window.Phase, window.RateMultiplier);
            }
        }

        return (MarketPhase.Closed, 0.0);
    }

    private static TimeZoneInfo ResolveTimeZone(string? id, ILogger logger)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            return TimeZoneInfo.Utc;
        }

        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(id);
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            // Falling back rather than throwing: an unknown zone id should not stop the exchange
            // from generating load, but it must never be silent, because every phase boundary
            // would then be at the wrong time.
            logger.LogWarning(
                ex, "Exchange time zone {TimeZoneId} is not available on this machine; falling back to UTC.", id);
            return TimeZoneInfo.Utc;
        }
    }
}
