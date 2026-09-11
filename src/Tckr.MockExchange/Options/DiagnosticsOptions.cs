using System.ComponentModel.DataAnnotations;
using Tckr.MockExchange.Diagnostics;

namespace Tckr.MockExchange.Options;

/// <summary>
/// Configuration for <see cref="ThroughputReporter"/>, the only thing in <c>Diagnostics/</c> that
/// has anything to configure.
/// </summary>
/// <remarks>
/// There is no metrics-exporter setting here on purpose. Everything the process measures is on the
/// <c>Tckr.MockExchange</c> meter already; pointing an exporter at it is a Phase 14 job done once
/// across every service, not a port for this component to open on its own.
/// </remarks>
internal sealed class DiagnosticsOptions
{
    /// <summary>Configuration section this binds from.</summary>
    internal const string SectionName = $"{MockExchangeOptions.SectionName}:Diagnostics";

    /// <summary>
    /// Seconds between throughput status lines. Minimum one.
    /// </summary>
    /// <remarks>
    /// The reporter's own constructor rejects anything below one, so this bound is stated twice —
    /// deliberately, and it is the one place that is worth it: without the attribute the failure
    /// arrives as an <see cref="ArgumentOutOfRangeException"/> from a hosted-service constructor
    /// rather than as a message naming the setting.
    /// </remarks>
    [Range(1, 3_600)]
    public int ThroughputReportIntervalSeconds { get; set; } = ThroughputReporter.DefaultReportIntervalSeconds;
}
