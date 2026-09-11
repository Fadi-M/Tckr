using System.ComponentModel.DataAnnotations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using Tckr.MockExchange.Session;

namespace Tckr.MockExchange.Options;

/// <summary>
/// Validates the whole <c>MockExchange</c> section at start-up: the per-property bounds the
/// nested objects declare, and the cross-field rules no attribute can express.
/// </summary>
/// <remarks>
/// <para>
/// This exists because <c>ValidateDataAnnotations()</c> is <b>shallow</b>. It runs
/// <see cref="Validator"/> over the object it is registered for and stops there, so every
/// <c>[Range]</c> on <see cref="GenerationOptions"/>, <see cref="MarketSessionOptions"/> and
/// <see cref="DiagnosticsOptions"/> would be inert — bound, never checked, and silently ignored.
/// A validator that is present and does nothing is worse than none at all, so the recursion is
/// done here explicitly.
/// </para>
/// <para>
/// It also holds the raw <see cref="IConfiguration"/>, because some of what can go wrong is
/// invisible on the bound object: the configuration binder swallows a per-item failure when it
/// binds a collection, so a phase entry with an unknown name or an unparseable time simply is not
/// there afterwards. A silently shorter schedule is precisely the kind of fault this class exists
/// to make loud, and the only place it can still be seen is the configuration itself.
/// </para>
/// <para>
/// Every failure names its setting by full configuration path, because the person reading it is
/// looking at a JSON file or an environment variable, not at a C# property.
/// </para>
/// </remarks>
internal sealed class MockExchangeOptionsValidator : IValidateOptions<MockExchangeOptions>
{
    private readonly IConfiguration _configuration;

    internal MockExchangeOptionsValidator(IConfiguration configuration) =>
        _configuration = configuration ?? throw new ArgumentNullException(nameof(configuration));

    /// <inheritdoc />
    public ValidateOptionsResult Validate(string? name, MockExchangeOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        List<string> failures = [];

        ValidateAnnotations(options.Generation, GenerationOptions.SectionName, failures);
        ValidateAnnotations(options.Session, MarketSessionOptions.SectionName, failures);
        ValidateAnnotations(options.Diagnostics, DiagnosticsOptions.SectionName, failures);

        ValidateGeneration(options.Generation, failures);
        ValidateSession(options.Session, failures);

        return failures.Count == 0
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail(failures);
    }

    /// <summary>Runs the <see cref="ValidationAttribute"/>s on one nested options object.</summary>
    private static void ValidateAnnotations(object instance, string sectionPath, List<string> failures)
    {
        List<ValidationResult> results = [];

        if (Validator.TryValidateObject(instance, new ValidationContext(instance), results, validateAllProperties: true))
        {
            return;
        }

        foreach (ValidationResult result in results)
        {
            string member = result.MemberNames.FirstOrDefault() ?? "(section)";
            failures.Add($"{sectionPath}:{member} — {result.ErrorMessage}");
        }
    }

    /// <summary>The generation rules that need two settings at once.</summary>
    /// <remarks>
    /// <see cref="Generation.RandomWalkGenerator"/>'s constructor also rejects each of these, and
    /// that is not redundant: its message names one setting, and the fault is always in the
    /// relationship between two. "MaxSpreadTicks must be greater than or equal to 1" sends the
    /// reader to the wrong line of the file.
    /// </remarks>
    private static void ValidateGeneration(GenerationOptions generation, List<string> failures)
    {
        RequireOrdered(generation.MinSpreadTicks, generation.MaxSpreadTicks, "MinSpreadTicks", "MaxSpreadTicks");
        RequireOrdered(generation.MinLots, generation.MaxLots, "MinLots", "MaxLots");
        RequireOrdered(generation.BlockMinLots, generation.BlockMaxLots, "BlockMinLots", "BlockMaxLots");

        // The mix is a set of shares, not probabilities: the generator normalises them, so 4/3/3
        // and 0.4/0.3/0.3 are the same configuration. The only unusable value is a mix with
        // nothing in it, which would otherwise divide by zero and produce a tape of one message
        // type. A mix that does not sum to 1.0 is legal and warned about at start-up instead.
        double mix = generation.TradeShare + generation.BidQuoteShare + generation.AskQuoteShare;
        if (mix <= 0d)
        {
            failures.Add(
                $"{GenerationOptions.SectionName}:TradeShare/BidQuoteShare/AskQuoteShare — the message mix is empty: " +
                "at least one share must be greater than zero.");
        }

        void RequireOrdered(long low, long high, string lowName, string highName)
        {
            if (high < low)
            {
                failures.Add(
                    $"{GenerationOptions.SectionName}:{highName} — must be greater than or equal to " +
                    $"{lowName}, but {highName}={high} and {lowName}={low}.");
            }
        }
    }

    /// <summary>The session rules: the rate ceiling, the time zone, and the phase schedule.</summary>
    private void ValidateSession(MarketSessionOptions session, List<string> failures)
    {
        if (session.MaxEventsPerSecond < session.BaseEventsPerSecond)
        {
            failures.Add(
                $"{MarketSessionOptions.SectionName}:MaxEventsPerSecond — must be greater than or equal to " +
                $"BaseEventsPerSecond, but MaxEventsPerSecond={session.MaxEventsPerSecond:F0} and " +
                $"BaseEventsPerSecond={session.BaseEventsPerSecond:F0}. The ceiling would clamp the target rate " +
                "before a phase multiplier ever applied.");
        }

        // MarketSessionClock falls back to UTC with a warning for an id it cannot resolve, which is
        // the right behaviour once the process is running and the wrong one at start-up: a
        // benchmark that silently ran its phases in the wrong zone is a result nobody can defend.
        try
        {
            TimeZoneInfo.FindSystemTimeZoneById(session.TimeZone);
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            failures.Add(
                $"{MarketSessionOptions.SectionName}:TimeZone — '{session.TimeZone}' does not resolve on this " +
                $"platform ({ex.GetType().Name}). Use an IANA id such as 'Africa/Cairo', or 'UTC'.");
        }

        ValidatePhases(session, failures);
        ValidateConfiguredPhases(session, failures);
    }

    /// <summary>Every window is a real interval, every phase is a defined one, and none overlap.</summary>
    private static void ValidatePhases(MarketSessionOptions session, List<string> failures)
    {
        string path = $"{MarketSessionOptions.SectionName}:Phases";

        IList<MarketPhaseWindow> phases = session.Phases ?? [];

        if (phases.Count == 0)
        {
            // Legal: Continuous mode never consults the schedule. In either of the other two modes
            // an empty schedule is a session that is Closed for ever, which is a silent no-op run.
            if (session.Mode != MarketSessionMode.Continuous)
            {
                failures.Add(
                    $"{path} — the schedule is empty, so every moment resolves to Closed and the exchange " +
                    $"would emit nothing in {session.Mode} mode.");
            }

            return;
        }

        for (int i = 0; i < phases.Count; i++)
        {
            MarketPhaseWindow window = phases[i];

            if (!Enum.IsDefined(window.Phase))
            {
                failures.Add($"{path}:{i}:Phase — '{(int)window.Phase}' is not a known market phase.");
            }

            if (window.Phase == MarketPhase.Closed)
            {
                failures.Add(
                    $"{path}:{i}:Phase — Closed is the absence of a window, not a window. Delete the entry " +
                    "instead; any time outside the schedule is already Closed.");
            }

            if (window.End <= window.Start)
            {
                failures.Add(
                    $"{path}:{i} — End ({window.End}) must be after Start ({window.Start}) for phase " +
                    $"{window.Phase}.");
            }

            if (window.Start < TimeSpan.Zero || window.End > TimeSpan.FromDays(1))
            {
                failures.Add(
                    $"{path}:{i} — Start and End are times of day and must lie within 00:00 to 24:00, but " +
                    $"phase {window.Phase} runs {window.Start} to {window.End}.");
            }

            if (window.RateMultiplier <= 0d || double.IsNaN(window.RateMultiplier))
            {
                failures.Add(
                    $"{path}:{i}:RateMultiplier — must be greater than zero, but phase {window.Phase} has " +
                    $"{window.RateMultiplier}. A phase that should emit nothing is one you omit.");
            }
        }

        // MarketSessionClock sorts by Start and takes the first window whose range contains the
        // instant, so an overlap is not an error it can report — it is a window that silently never
        // wins. Ordering the copy rather than the bound list keeps the configuration as written.
        MarketPhaseWindow[] ordered = [.. phases.OrderBy(w => w.Start)];

        for (int i = 1; i < ordered.Length; i++)
        {
            if (ordered[i].Start < ordered[i - 1].End)
            {
                failures.Add(
                    $"{path} — phase {ordered[i].Phase} starts at {ordered[i].Start}, before phase " +
                    $"{ordered[i - 1].Phase} ends at {ordered[i - 1].End}. Windows must not overlap: the " +
                    "earlier one wins and the later one would never take effect.");
            }
        }
    }

    /// <summary>
    /// Compares the phase schedule as configured with the phase schedule as bound.
    /// </summary>
    /// <remarks>
    /// <c>ConfigurationBinder</c> binds a collection item inside a <c>try</c> and moves on when it
    /// throws, so an entry naming a phase that does not exist, or a <c>Start</c> that is not a
    /// time, is dropped rather than reported. The exchange then runs a schedule that is quietly
    /// missing a window — most likely the opening auction, since that is the entry someone was
    /// editing when they made the typo. Nothing on the bound object records that this happened, so
    /// the check has to read what was written.
    /// </remarks>
    private void ValidateConfiguredPhases(MarketSessionOptions session, List<string> failures)
    {
        string path = $"{MarketSessionOptions.SectionName}:Phases";

        IConfigurationSection[] configured = [.. _configuration.GetSection(path).GetChildren()];

        if (configured.Length == 0)
        {
            return;
        }

        foreach (IConfigurationSection entry in configured)
        {
            string? phaseName = entry["Phase"];

            if (!string.IsNullOrWhiteSpace(phaseName)
                && !Enum.TryParse(phaseName, ignoreCase: true, out MarketPhase _))
            {
                failures.Add(
                    $"{path}:{entry.Key}:Phase — '{phaseName}' is not a known market phase. Valid names are "
                    + $"{string.Join(", ", Enum.GetNames<MarketPhase>().Where(n => n != nameof(MarketPhase.Closed)))}.");
            }
        }

        int bound = session.Phases?.Count ?? 0;

        if (bound != configured.Length)
        {
            failures.Add(
                $"{path} — the configuration has {configured.Length} phase entries but only {bound} bound. "
                + "An entry the binder cannot read is discarded silently, so one of them has a value it cannot "
                + "parse — most often a Start or End that is not a time of day, or a Phase that is not a known name.");
        }
    }
}
