using System.ComponentModel.DataAnnotations;

namespace Tckr.MockExchange.Options;

/// <summary>
/// The root of the <c>MockExchange</c> configuration section: everything the process is told at
/// start-up, in four groups that match the four components it wires together.
/// </summary>
/// <remarks>
/// <para>
/// Bound once, validated once, and then handed to the components as four separate objects. The
/// nesting is not decoration: <see cref="Generation"/> is a reproducibility unit, and every
/// property in it belongs to the tape rather than to the process, which is why the run seed lives
/// there and not here.
/// </para>
/// <para>
/// Every setting is overridable by environment variable through the double-underscore convention
/// the default configuration providers apply, so
/// <c>MockExchange__Session__BaseEventsPerSecond=25000</c> sweeps the rate without editing a file.
/// Task 09 depends on that; there is a test pinning it.
/// </para>
/// </remarks>
internal sealed class MockExchangeOptions
{
    /// <summary>Configuration section this binds from.</summary>
    internal const string SectionName = "MockExchange";

    /// <summary>The tape: seed, universe size, walk shape and message mix.</summary>
    [Required]
    public GenerationOptions Generation { get; set; } = new();

    /// <summary>The pacing: base rate, batch interval, session mode and the phase schedule.</summary>
    [Required]
    public MarketSessionOptions Session { get; set; } = new();

    /// <summary>The transport: listen endpoint, session limits and the slow-consumer policy.</summary>
    [Required]
    public FeedServerOptions Feed { get; set; } = new();

    /// <summary>The status line.</summary>
    [Required]
    public DiagnosticsOptions Diagnostics { get; set; } = new();
}
