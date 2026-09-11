using System.Text.Json;
using System.Text.Json.Nodes;

namespace Tckr.FeedProbe;

/// <summary>
/// Serialises a <see cref="ProbeReport"/> to the JSON schema written by <c>--output</c>, for task 09
/// to consume.
/// </summary>
/// <remarks>
/// Built with <see cref="JsonObject"/> directly rather than a DTO plus source-generated
/// serialization: nine independent sections, written once at the end of a run, is not the hot path
/// that ceremony exists to protect. The schema itself is documented in this task's brief notes
/// ("Notes for other tasks") — keep the two in sync if a field here changes.
/// </remarks>
internal static class JsonReport
{
    private static readonly JsonSerializerOptions WriteOptions = new() { WriteIndented = true };

    internal static void WriteToFile(ProbeReport report, string path)
    {
        string? directory = Path.GetDirectoryName(Path.GetFullPath(path));
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        File.WriteAllText(path, Build(report).ToJsonString(WriteOptions));
    }

    internal static JsonObject Build(ProbeReport r)
    {
        var root = new JsonObject
        {
            ["schemaVersion"] = 1,
            ["host"] = r.Host,
            ["port"] = r.Port,
            ["sessionEstablished"] = r.SessionEstablished,
            ["sessionId"] = r.SessionId == Guid.Empty ? null : r.SessionId.ToString(),
            ["startedAtUtc"] = r.StartedAtUtc,
            ["endedAtUtc"] = r.EndedAtUtc,
            ["activeSeconds"] = r.ActiveSeconds,
            ["endReason"] = r.EndReason,
            ["result"] = r.Passed ? "PASS" : "FAIL",
            ["exitCode"] = r.ExitCode,
        };

        if (!r.SessionEstablished)
        {
            // Nothing downstream of a connection was ever measured; the fields above are the
            // whole story. See ProbeSession's remarks on why refusal and a true connect failure
            // both land here rather than being split into separate exit codes.
            return root;
        }

        root["heartbeatIntervalMsAdvertised"] = r.HeartbeatIntervalMsAdvertised;
        root["eventsReceived"] = r.EventsReceived;

        root["achievedRate"] = new JsonObject
        {
            ["overall"] = r.AchievedRateOverall,
            ["min"] = r.AchievedRateMin,
            ["max"] = r.AchievedRateMax,
            ["target"] = r.TargetEventsPerSecond,
            ["targetPercent"] = r.TargetEventsPerSecond <= 0
                ? 0
                : 100.0 * r.AchievedRateOverall / r.TargetEventsPerSecond,
            ["note"] = "min/max are per report-interval rates; a --stall-after run legitimately " +
                       "shows a near-zero minimum for the interval spanning the pause.",
        };

        var gaps = new JsonArray();
        foreach (GapEvent g in r.Gaps)
        {
            gaps.Add(new JsonObject
            {
                ["expectedSeq"] = g.ExpectedSequence,
                ["receivedSeq"] = g.ReceivedSequence,
                ["gapSize"] = g.GapSize,
                ["timestampUtc"] = g.ObservedAtUtc,
            });
        }

        var integrityViolations = new JsonArray();
        foreach (SequenceIntegrityViolation v in r.IntegrityViolations)
        {
            integrityViolations.Add(new JsonObject
            {
                ["expectedSeq"] = v.ExpectedSequence,
                ["receivedSeq"] = v.ReceivedSequence,
                ["timestampUtc"] = v.ObservedAtUtc,
            });
        }

        root["sequence"] = new JsonObject
        {
            ["gapCount"] = r.Gaps.Count,
            ["recordsLost"] = r.RecordsLost,
            ["expectDrops"] = r.ExpectDrops,
            ["gaps"] = gaps,
            ["integrityViolationCount"] = r.IntegrityViolations.Count,
            ["integrityViolations"] = integrityViolations,
            ["note"] = "Every gap here is exchange-side loss, never network loss: TCP delivers in " +
                       "order or breaks, and the frame reader throws rather than resynchronising " +
                       "past a bad frame. Under the default Disconnect policy a gap should never " +
                       "occur — the session is closed instead; under DropOldest a gap is the " +
                       "documented, expected disclosure of what the server withheld. " +
                       "integrityViolations (a sequence number at or below one already seen) is a " +
                       "different, always-a-bug condition — reorder or duplication is impossible on " +
                       "a single TCP session.",
        };

        var framingErrors = new JsonArray();
        foreach (FramingErrorEvent f in r.FramingErrors)
        {
            framingErrors.Add(new JsonObject { ["message"] = f.Message, ["timestampUtc"] = f.ObservedAtUtc });
        }

        root["framingErrors"] = new JsonObject { ["count"] = r.FramingErrors.Count, ["errors"] = framingErrors };

        root["wire"] = new JsonObject
        {
            ["totalBytes"] = r.TotalBytes,
            ["bytesPerSecond"] = r.BytesPerSecond,
            ["meanBytesPerEvent"] = r.MeanBytesPerEvent,
        };

        root["interArrivalMs"] = PercentileNode(r.InterArrival);
        root["deliveryLatencyMs"] = PercentileNode(
            r.DeliveryLatency,
            "Clocks are shared (same host) in Phase 2, so this is meaningful now. It becomes " +
            "unreliable once the probe and the exchange run on different machines; do not trust " +
            "it blindly once that changes.");

        root["messageMix"] = new JsonObject
        {
            ["trade"] = r.TradeCount,
            ["bid"] = r.BidCount,
            ["ask"] = r.AskCount,
        };

        var topSymbols = new JsonArray();
        foreach (SymbolShare s in r.TopSymbols)
        {
            topSymbols.Add(new JsonObject
            {
                ["symbol"] = s.Symbol,
                ["count"] = s.Count,
                ["sharePercent"] = s.SharePercent,
            });
        }

        root["symbolSkew"] = new JsonObject
        {
            ["distinctSymbolsSeen"] = r.DistinctSymbolsSeen,
            ["top1Percent"] = r.Top1Percent,
            ["top10Percent"] = r.Top10Percent,
            ["top50Percent"] = r.Top50Percent,
            ["topSymbols"] = topSymbols,
        };

        var priceSummaries = new JsonArray();
        foreach (SymbolPriceSummary p in r.PriceSummaries)
        {
            priceSummaries.Add(new JsonObject
            {
                ["symbol"] = p.Symbol,
                ["count"] = p.Count,
                ["min"] = p.MinPrice,
                ["max"] = p.MaxPrice,
                ["maxSingleStepMove"] = p.MaxSingleStepMove,
            });
        }

        root["priceSanity"] = new JsonObject
        {
            ["perSymbol"] = priceSummaries,
            ["note"] = "Observation only, not an assertion. Task 08 depends only on tasks 01 and " +
                       "05, not on the symbol universe or the generator (02/03), so the probe has " +
                       "no independent source for a symbol's real tick size or the server's " +
                       "MaxTickMove. Min, max and the largest single observed step per symbol are " +
                       "reported for a human or task 09 to judge against the server's own " +
                       "configuration; the probe does not flag or fail on any of them.",
        };

        root["auctionPrintFlag"] = new JsonObject
        {
            ["observedCount"] = r.AuctionPrintCount,
            ["note"] = "Observation only. The default Session:Mode (Continuous) never enters an " +
                       "auction phase, so 0 is the expected value on every default benchmark run, " +
                       "not a failure. Set MockExchange__Session__Mode=CompressedDay to see it set.",
        };

        root["heartbeats"] = new JsonObject
        {
            ["count"] = r.HeartbeatCount,
            ["configuredIntervalMs"] = r.HeartbeatIntervalMsAdvertised,
            ["maxIntervalMs"] = r.MaxHeartbeatIntervalMs,
            ["exceeded2xCount"] = r.HeartbeatIntervalExceeded2x,
            ["note"] = "Heartbeats appear only while the session is idle; a probe under sustained " +
                       "load may legitimately see none for the whole run. Zero heartbeats is not a " +
                       "failure by itself.",
        };

        var orderViolations = new JsonArray();
        foreach (OrderViolationEvent v in r.OrderViolations)
        {
            orderViolations.Add(new JsonObject
            {
                ["symbol"] = v.Symbol,
                ["sequenceNumber"] = v.SequenceNumber,
                ["previousTimestampNanos"] = v.PreviousTimestampNanos,
                ["observedTimestampNanos"] = v.ObservedTimestampNanos,
            });
        }

        root["verifyOrder"] = new JsonObject
        {
            ["enabled"] = r.VerifyOrderEnabled,
            ["violationCount"] = r.OrderViolations.Count,
            ["violations"] = orderViolations,
        };

        root["stall"] = new JsonObject
        {
            ["requestedAfterSeconds"] = r.StallAfterSeconds,
            ["pauseDurationSeconds"] = r.StallAfterSeconds is null ? null : r.StallDurationSeconds,
            ["outcome"] = r.StallOutcome,
        };

        return root;
    }

    private static JsonObject PercentileNode(PercentileSummary p, string? note = null)
    {
        var node = new JsonObject
        {
            ["p50"] = p.P50Ms,
            ["p95"] = p.P95Ms,
            ["p99"] = p.P99Ms,
            ["max"] = p.MaxMs,
        };

        if (note is not null)
        {
            node["note"] = note;
        }

        return node;
    }
}
