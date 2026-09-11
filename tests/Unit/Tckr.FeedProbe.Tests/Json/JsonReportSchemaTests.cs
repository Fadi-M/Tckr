using System.Text.Json.Nodes;

namespace Tckr.FeedProbe.Tests.Json;

/// <summary>
/// Pins the <c>--output</c> JSON schema documented in <c>08-feed-probe.md</c>'s "Notes for other
/// tasks" section — exact field names and nesting, at every level, so a future rename breaks this
/// test instead of silently breaking whatever (task 09 and beyond) parses the file.
/// </summary>
public class JsonReportSchemaTests
{
    [Fact]
    public void AnEstablishedSessionReportHasExactlyTheDocumentedTopLevelFields()
    {
        JsonObject root = JsonReport.Build(EstablishedReport());

        root.Select(kv => kv.Key).ShouldBe(
            [
                "schemaVersion", "host", "port", "sessionEstablished", "sessionId", "startedAtUtc",
                "endedAtUtc", "activeSeconds", "endReason", "result", "exitCode",
                "heartbeatIntervalMsAdvertised", "eventsReceived", "achievedRate", "sequence",
                "framingErrors", "wire", "interArrivalMs", "deliveryLatencyMs", "messageMix",
                "symbolSkew", "priceSanity", "auctionPrintFlag", "heartbeats", "verifyOrder", "stall",
            ],
            ignoreOrder: true);

        root["schemaVersion"]!.GetValue<int>().ShouldBe(1);
        root["result"]!.GetValue<string>().ShouldBe("PASS");
    }

    [Fact]
    public void AConnectionFailureReportHasOnlyTheConnectionFields()
    {
        JsonObject root = JsonReport.Build(UnestablishedReport());

        root.Select(kv => kv.Key).ShouldBe(
            [
                "schemaVersion", "host", "port", "sessionEstablished", "sessionId", "startedAtUtc",
                "endedAtUtc", "activeSeconds", "endReason", "result", "exitCode",
            ],
            ignoreOrder: true);

        root["sessionEstablished"]!.GetValue<bool>().ShouldBeFalse();
        root["result"]!.GetValue<string>().ShouldBe("FAIL");
        root["exitCode"]!.GetValue<int>().ShouldBe(3);
    }

    [Fact]
    public void AchievedRateSectionHasTheDocumentedFields()
    {
        JsonObject achievedRate = JsonReport.Build(EstablishedReport())["achievedRate"]!.AsObject();

        achievedRate.Select(kv => kv.Key).ShouldBe(
            ["overall", "min", "max", "target", "targetPercent", "note"], ignoreOrder: true);
    }

    [Fact]
    public void SequenceSectionHasTheDocumentedFieldsAndGapShape()
    {
        JsonObject root = JsonReport.Build(EstablishedReport());
        JsonObject sequence = root["sequence"]!.AsObject();

        sequence.Select(kv => kv.Key).ShouldBe(
            [
                "gapCount", "recordsLost", "expectDrops", "gaps", "integrityViolationCount",
                "integrityViolations", "note",
            ],
            ignoreOrder: true);

        JsonObject gap = sequence["gaps"]!.AsArray()[0]!.AsObject();
        gap.Select(kv => kv.Key).ShouldBe(
            ["expectedSeq", "receivedSeq", "gapSize", "timestampUtc"], ignoreOrder: true);

        JsonObject violation = sequence["integrityViolations"]!.AsArray()[0]!.AsObject();
        violation.Select(kv => kv.Key).ShouldBe(
            ["expectedSeq", "receivedSeq", "timestampUtc"], ignoreOrder: true);
    }

    [Fact]
    public void FramingErrorsSectionHasTheDocumentedFields()
    {
        JsonObject framingErrors = JsonReport.Build(EstablishedReport())["framingErrors"]!.AsObject();

        framingErrors.Select(kv => kv.Key).ShouldBe(["count", "errors"], ignoreOrder: true);
        JsonObject error = framingErrors["errors"]!.AsArray()[0]!.AsObject();
        error.Select(kv => kv.Key).ShouldBe(["message", "timestampUtc"], ignoreOrder: true);
    }

    [Fact]
    public void WireSectionHasTheDocumentedFields()
    {
        JsonObject wire = JsonReport.Build(EstablishedReport())["wire"]!.AsObject();

        wire.Select(kv => kv.Key).ShouldBe(["totalBytes", "bytesPerSecond", "meanBytesPerEvent"], ignoreOrder: true);
    }

    [Fact]
    public void InterArrivalHasNoNoteButDeliveryLatencyDoes()
    {
        JsonObject root = JsonReport.Build(EstablishedReport());

        // These two sections share a renderer (JsonReport.PercentileNode) but differ on purpose:
        // only delivery latency carries the same-host-clock caveat.
        root["interArrivalMs"]!.AsObject().Select(kv => kv.Key).ShouldBe(
            ["p50", "p95", "p99", "max"], ignoreOrder: true);

        root["deliveryLatencyMs"]!.AsObject().Select(kv => kv.Key).ShouldBe(
            ["p50", "p95", "p99", "max", "note"], ignoreOrder: true);
    }

    [Fact]
    public void MessageMixSectionHasTheDocumentedFields()
    {
        JsonObject mix = JsonReport.Build(EstablishedReport())["messageMix"]!.AsObject();

        mix.Select(kv => kv.Key).ShouldBe(["trade", "bid", "ask"], ignoreOrder: true);
    }

    [Fact]
    public void SymbolSkewSectionHasTheDocumentedFieldsAndTopSymbolShape()
    {
        JsonObject skew = JsonReport.Build(EstablishedReport())["symbolSkew"]!.AsObject();

        skew.Select(kv => kv.Key).ShouldBe(
            ["distinctSymbolsSeen", "top1Percent", "top10Percent", "top50Percent", "topSymbols"],
            ignoreOrder: true);

        JsonObject symbol = skew["topSymbols"]!.AsArray()[0]!.AsObject();
        symbol.Select(kv => kv.Key).ShouldBe(["symbol", "count", "sharePercent"], ignoreOrder: true);
    }

    [Fact]
    public void PriceSanitySectionHasTheDocumentedFieldsAndIsObservationOnly()
    {
        JsonObject priceSanity = JsonReport.Build(EstablishedReport())["priceSanity"]!.AsObject();

        priceSanity.Select(kv => kv.Key).ShouldBe(["perSymbol", "note"], ignoreOrder: true);
        JsonObject symbol = priceSanity["perSymbol"]!.AsArray()[0]!.AsObject();
        symbol.Select(kv => kv.Key).ShouldBe(["symbol", "count", "min", "max", "maxSingleStepMove"], ignoreOrder: true);
    }

    [Fact]
    public void AuctionPrintFlagSectionHasTheDocumentedFields()
    {
        JsonObject flag = JsonReport.Build(EstablishedReport())["auctionPrintFlag"]!.AsObject();

        flag.Select(kv => kv.Key).ShouldBe(["observedCount", "note"], ignoreOrder: true);
    }

    [Fact]
    public void HeartbeatsSectionHasTheDocumentedFields()
    {
        JsonObject heartbeats = JsonReport.Build(EstablishedReport())["heartbeats"]!.AsObject();

        heartbeats.Select(kv => kv.Key).ShouldBe(
            ["count", "configuredIntervalMs", "maxIntervalMs", "exceeded2xCount", "note"], ignoreOrder: true);
    }

    [Fact]
    public void VerifyOrderSectionHasTheDocumentedFieldsAndViolationShape()
    {
        JsonObject verifyOrder = JsonReport.Build(EstablishedReport())["verifyOrder"]!.AsObject();

        verifyOrder.Select(kv => kv.Key).ShouldBe(["enabled", "violationCount", "violations"], ignoreOrder: true);
        JsonObject violation = verifyOrder["violations"]!.AsArray()[0]!.AsObject();
        violation.Select(kv => kv.Key).ShouldBe(
            ["symbol", "sequenceNumber", "previousTimestampNanos", "observedTimestampNanos"], ignoreOrder: true);
    }

    [Fact]
    public void StallSectionHasTheDocumentedFields()
    {
        JsonObject stall = JsonReport.Build(EstablishedReport())["stall"]!.AsObject();

        stall.Select(kv => kv.Key).ShouldBe(["requestedAfterSeconds", "pauseDurationSeconds", "outcome"], ignoreOrder: true);
    }

    private static ProbeReport EstablishedReport()
    {
        DateTimeOffset now = DateTimeOffset.UtcNow;

        return new ProbeReport
        {
            Host = "localhost",
            Port = 9001,
            SessionEstablished = true,
            SessionId = Guid.NewGuid(),
            HeartbeatIntervalMsAdvertised = 1000,
            StartedAtUtc = now.AddSeconds(-30),
            EndedAtUtc = now,
            ActiveSeconds = 30,
            EndReason = "duration-elapsed",
            EventsReceived = 100,
            AchievedRateOverall = 25_000,
            AchievedRateMin = 24_900,
            AchievedRateMax = 25_100,
            TargetEventsPerSecond = 25_000,
            Gaps = [new GapEvent(3, 5, 2, now)],
            RecordsLost = 2,
            IntegrityViolations = [new SequenceIntegrityViolation(4, 2, now)],
            FramingErrors = [new FramingErrorEvent("bad length prefix", now)],
            ExpectDrops = false,
            TotalBytes = 4400,
            BytesPerSecond = 146.6,
            MeanBytesPerEvent = 44.0,
            InterArrival = PercentileSummary.FromNanoseconds([1_000_000, 2_000_000]),
            DeliveryLatency = PercentileSummary.FromNanoseconds([500_000, 1_500_000]),
            TradeCount = 40,
            BidCount = 30,
            AskCount = 30,
            TopSymbols = [new SymbolShare("COMI", 50, 50.0)],
            Top1Percent = 50.0,
            Top10Percent = 90.0,
            Top50Percent = 100.0,
            DistinctSymbolsSeen = 5,
            PriceSummaries = [new SymbolPriceSummary("COMI", 50, 85.10m, 86.00m, 0.20m)],
            AuctionPrintCount = 0,
            HeartbeatCount = 2,
            MaxHeartbeatIntervalMs = 1010,
            HeartbeatIntervalExceeded2x = 0,
            VerifyOrderEnabled = true,
            OrderViolations = [new OrderViolationEvent("COMI", 42, 100, 90)],
            StallAfterSeconds = 5,
            StallDurationSeconds = 5,
            StallOutcome = "continued",
            ExitCode = 0,
        };
    }

    private static ProbeReport UnestablishedReport()
    {
        DateTimeOffset now = DateTimeOffset.UtcNow;

        return new ProbeReport
        {
            Host = "localhost",
            Port = 9001,
            SessionEstablished = false,
            StartedAtUtc = now,
            EndedAtUtc = now,
            ActiveSeconds = 0,
            EndReason = "connect-failed: refused",
            EventsReceived = 0,
            AchievedRateOverall = 0,
            AchievedRateMin = 0,
            AchievedRateMax = 0,
            TargetEventsPerSecond = 25_000,
            Gaps = [],
            RecordsLost = 0,
            IntegrityViolations = [],
            FramingErrors = [],
            ExpectDrops = false,
            TotalBytes = 0,
            BytesPerSecond = 0,
            MeanBytesPerEvent = 0,
            InterArrival = PercentileSummary.Empty,
            DeliveryLatency = PercentileSummary.Empty,
            TradeCount = 0,
            BidCount = 0,
            AskCount = 0,
            TopSymbols = [],
            Top1Percent = 0,
            Top10Percent = 0,
            Top50Percent = 0,
            DistinctSymbolsSeen = 0,
            PriceSummaries = [],
            AuctionPrintCount = 0,
            HeartbeatCount = 0,
            MaxHeartbeatIntervalMs = 0,
            HeartbeatIntervalExceeded2x = 0,
            VerifyOrderEnabled = false,
            OrderViolations = [],
            ExitCode = 3,
        };
    }
}
