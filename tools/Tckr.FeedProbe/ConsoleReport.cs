namespace Tckr.FeedProbe;

/// <summary>Renders a <see cref="ProbeReport"/> — and the periodic progress line while a run is in flight — to the console.</summary>
internal static class ConsoleReport
{
    private const string HeavyRule = "════════════════════════════════════════════════════════════";
    private const string ThinRule = "────────────────────────────────────────────────────────────";

    internal static void PrintBanner(ProbeOptions options)
    {
        string duration = options.DurationSeconds == 0 ? "until Ctrl+C" : $"{options.DurationSeconds}s";
        Console.WriteLine(
            $"Tckr.FeedProbe connecting to {options.Host}:{options.Port} " +
            $"(duration {duration}, target {options.TargetEventsPerSecond:N0}/s" +
            $"{(options.ExpectDrops ? ", expecting drops" : "")})");
    }

    internal static void PrintInterval(
        TimeSpan elapsed, ulong eventsReceived, double intervalRate, double overallRate,
        int gapsSoFar, int framingErrorsSoFar)
    {
        Console.WriteLine(
            $" [{elapsed.TotalSeconds,6:F1}s] events {eventsReceived,12:N0}   " +
            $"interval {intervalRate,9:N0}/s   overall {overallRate,9:N0}/s   " +
            $"gaps {gapsSoFar,3}   framing-errors {framingErrorsSoFar,3}");
    }

    internal static void PrintNotice(string message) => Console.WriteLine($" [probe] {message}");

    internal static void PrintFinal(ProbeReport report)
    {
        if (!report.SessionEstablished)
        {
            PrintConnectionFailure(report);
            return;
        }

        Console.WriteLine();
        Console.WriteLine(HeavyRule);
        Console.WriteLine($" Tckr.FeedProbe — session {ShortId(report.SessionId)} — {report.ActiveSeconds:F1}s");
        Console.WriteLine(ThinRule);

        double targetPercent = report.TargetEventsPerSecond <= 0
            ? 0
            : 100.0 * report.AchievedRateOverall / report.TargetEventsPerSecond;

        Console.WriteLine($" Events received      {report.EventsReceived,12:N0}");
        Console.WriteLine(
            $" Achieved rate        {report.AchievedRateOverall,9:N0} /s   " +
            $"(target {report.TargetEventsPerSecond:N0} — {targetPercent:F1}%)");
        Console.WriteLine(
            $" Rate min/max         {report.AchievedRateMin,9:N0} /s   {report.AchievedRateMax,9:N0} /s   " +
            "(per report interval)");
        Console.WriteLine(
            $" Sequence gaps        {report.Gaps.Count,3}   ({report.RecordsLost:N0} record(s) lost" +
            $"{(report.ExpectDrops ? ", expected under DropOldest" : "")})");
        Console.WriteLine(
            $" Sequence integrity   {report.IntegrityViolations.Count,3}   (reorder/duplicate — always a bug, never a policy)");
        Console.WriteLine($" Framing errors       {report.FramingErrors.Count,3}");
        Console.WriteLine(
            $" Wire throughput      {report.BytesPerSecond / (1024.0 * 1024.0),6:F2} MB/s   " +
            $"({report.MeanBytesPerEvent:F1} bytes/event)");
        Console.WriteLine(
            $" Inter-arrival        p50 {report.InterArrival.P50Ms:F2}ms  p95 {report.InterArrival.P95Ms:F2}ms  " +
            $"p99 {report.InterArrival.P99Ms:F2}ms  max {report.InterArrival.MaxMs:F2}ms");
        Console.WriteLine(
            $" Delivery latency     p50 {report.DeliveryLatency.P50Ms:F2}ms  p95 {report.DeliveryLatency.P95Ms:F2}ms  " +
            $"p99 {report.DeliveryLatency.P99Ms:F2}ms  max {report.DeliveryLatency.MaxMs:F2}ms  " +
            "(same-host clock — see notes)");

        long mixTotal = Math.Max(1, report.TradeCount + report.BidCount + report.AskCount);
        Console.WriteLine(
            $" Message mix          trade {100.0 * report.TradeCount / mixTotal:F1}%  " +
            $"bid {100.0 * report.BidCount / mixTotal:F1}%  ask {100.0 * report.AskCount / mixTotal:F1}%");
        Console.WriteLine(
            $" Symbol skew          top-1 {report.Top1Percent:F1}%  top-10 {report.Top10Percent:F1}%  " +
            $"top-50 {report.Top50Percent:F1}%  ({report.DistinctSymbolsSeen} symbols seen)");
        Console.WriteLine(
            $" Heartbeats           {report.HeartbeatCount,3}   max interval {report.MaxHeartbeatIntervalMs:F0}ms   " +
            $"(configured {report.HeartbeatIntervalMsAdvertised}ms; {report.HeartbeatIntervalExceeded2x} exceeded 2x)");
        Console.WriteLine(
            $" Auction prints       {report.AuctionPrintCount,3}   " +
            "(observation only — Flags=0 on the default Continuous session mode; see notes)");

        if (report.VerifyOrderEnabled)
        {
            Console.WriteLine($" Order violations     {report.OrderViolations.Count,3}   (--verify-order)");
        }

        if (report.StallAfterSeconds is { } stallAfter)
        {
            Console.WriteLine(
                $" Stall test           --stall-after {stallAfter}s, paused {report.StallDurationSeconds}s, " +
                $"outcome: {report.StallOutcome}");
        }

        if (report.TopSymbols.Count > 0)
        {
            Console.WriteLine(ThinRule);
            Console.WriteLine($" Top {report.TopSymbols.Count} symbols");
            foreach (SymbolShare s in report.TopSymbols)
            {
                Console.WriteLine($"   {s.Symbol,-8} {s.Count,10:N0}   {s.SharePercent,5:F1}%");
            }
        }

        Console.WriteLine(ThinRule);
        Console.WriteLine($" End reason: {report.EndReason}");
        Console.WriteLine($" RESULT: {(report.Passed ? "PASS" : "FAIL")}   (exit {report.ExitCode})");
        Console.WriteLine(HeavyRule);
    }

    private static void PrintConnectionFailure(ProbeReport report)
    {
        Console.WriteLine();
        Console.WriteLine(HeavyRule);
        Console.WriteLine($" Tckr.FeedProbe — {report.Host}:{report.Port}");
        Console.WriteLine(ThinRule);
        Console.WriteLine($" Connection failed: {report.EndReason}");
        Console.WriteLine($" RESULT: FAIL   (exit {report.ExitCode})");
        Console.WriteLine(HeavyRule);
    }

    private static string ShortId(Guid id)
    {
        string s = id.ToString("N");
        return s.Length <= 8 ? s : $"{s[..4]}…{s[^4..]}";
    }
}
