namespace Tckr.FeedProbe;

/// <summary>One row of the symbol distribution table.</summary>
internal readonly record struct SymbolShare(string Symbol, long Count, double SharePercent);

/// <summary>One row of the per-symbol price-sanity table.</summary>
internal readonly record struct SymbolPriceSummary(
    string Symbol, long Count, decimal MinPrice, decimal MaxPrice, decimal MaxSingleStepMove);

/// <summary>
/// Everything the probe measured and decided about one run, independent of how it is presented.
/// </summary>
/// <remarks>
/// Built once, at the end of a run (or at the point Ctrl+C or a fatal condition ends it early), by
/// <see cref="ProbeSession"/>. <see cref="ConsoleReport"/> and <see cref="JsonReport"/> both render
/// this same instance, so the console summary and the <c>--output</c> JSON can never disagree about
/// what happened.
/// </remarks>
internal sealed class ProbeReport
{
    // ---- connection and session -----------------------------------------------------------

    internal required string Host { get; init; }
    internal required int Port { get; init; }

    /// <summary>False when the connection never produced a decoded <c>SessionStart</c> frame.</summary>
    internal required bool SessionEstablished { get; init; }

    internal Guid SessionId { get; init; }
    internal uint HeartbeatIntervalMsAdvertised { get; init; }
    internal DateTimeOffset StartedAtUtc { get; init; }
    internal DateTimeOffset EndedAtUtc { get; init; }

    /// <summary>Wall-clock time the probe was actually reading, excluding any <c>--stall-after</c> pause.</summary>
    internal required double ActiveSeconds { get; init; }

    /// <summary>How the run ended: <c>duration-elapsed</c>, <c>ctrl-c</c>, <c>eof</c>, <c>reset</c>, <c>framing-error</c>, <c>stale</c>, <c>refused</c>.</summary>
    internal required string EndReason { get; init; }

    // ---- headline measurements --------------------------------------------------------------

    internal required ulong EventsReceived { get; init; }
    internal required double AchievedRateOverall { get; init; }
    internal required double AchievedRateMin { get; init; }
    internal required double AchievedRateMax { get; init; }
    internal required double TargetEventsPerSecond { get; init; }

    internal required IReadOnlyList<GapEvent> Gaps { get; init; }
    internal required ulong RecordsLost { get; init; }
    internal required IReadOnlyList<SequenceIntegrityViolation> IntegrityViolations { get; init; }
    internal required IReadOnlyList<FramingErrorEvent> FramingErrors { get; init; }

    internal required bool ExpectDrops { get; init; }

    // ---- wire and timing -----------------------------------------------------------------

    internal required long TotalBytes { get; init; }
    internal required double BytesPerSecond { get; init; }
    internal required double MeanBytesPerEvent { get; init; }
    internal required PercentileSummary InterArrival { get; init; }
    internal required PercentileSummary DeliveryLatency { get; init; }

    // ---- mix and distribution --------------------------------------------------------------

    internal required long TradeCount { get; init; }
    internal required long BidCount { get; init; }
    internal required long AskCount { get; init; }
    internal required IReadOnlyList<SymbolShare> TopSymbols { get; init; }
    internal required double Top1Percent { get; init; }
    internal required double Top10Percent { get; init; }
    internal required double Top50Percent { get; init; }
    internal required int DistinctSymbolsSeen { get; init; }

    // ---- price sanity (observation only — see the class remarks in ProbeSession) -----------

    internal required IReadOnlyList<SymbolPriceSummary> PriceSummaries { get; init; }

    // ---- auction print flag (observation only — see task 08 brief, "From task 06") ---------

    internal required long AuctionPrintCount { get; init; }

    // ---- heartbeats --------------------------------------------------------------------------

    internal required long HeartbeatCount { get; init; }
    internal required double MaxHeartbeatIntervalMs { get; init; }
    internal required int HeartbeatIntervalExceeded2x { get; init; }

    // ---- --verify-order ----------------------------------------------------------------------

    internal required bool VerifyOrderEnabled { get; init; }
    internal required IReadOnlyList<OrderViolationEvent> OrderViolations { get; init; }

    // ---- --stall-after -------------------------------------------------------------------

    internal int? StallAfterSeconds { get; init; }
    internal int StallDurationSeconds { get; init; }

    /// <summary>What happened when reading resumed after the pause: <c>eof</c>, <c>reset</c>, <c>continued</c>, or <c>n/a</c>.</summary>
    internal string StallOutcome { get; init; } = "n/a";

    // ---- result ------------------------------------------------------------------------------

    internal required int ExitCode { get; init; }
    internal bool Passed => ExitCode == 0;
}
