using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Testing;
using Tckr.MockExchange.Diagnostics;

namespace Tckr.MockExchange.Tests.Diagnostics;

/// <summary>
/// The start-up line, which exists so a benchmark result can be traced back to the run that
/// produced it.
/// </summary>
public class StartupSummaryTests
{
    [Fact]
    public void LogsEverythingNeededToReproduceTheRun()
    {
        FakeLogger logger = new();

        StartupSummary.Log(logger, seed: 20260304, symbolCount: 250, targetEventsPerSecond: 25_000,
            sessionMode: "CompressedDay", listenEndpoint: "0.0.0.0:5001");

        FakeLogRecord record = logger.Collector.GetSnapshot()[0];
        string[] properties = [.. record.StructuredState!.Select(p => p.Key)];

        record.Level.ShouldBe(LogLevel.Information);
        properties.ShouldContain("Seed");
        properties.ShouldContain("SymbolCount");
        properties.ShouldContain("TargetRate");
        properties.ShouldContain("SessionMode");
        properties.ShouldContain("ListenEndpoint");
        properties.ShouldContain("BuildConfiguration");
        record.Message.ShouldContain("seed=20260304");
        record.Message.ShouldContain("listen=0.0.0.0:5001");
    }

    /// <summary>
    /// Throughput from a DEBUG build is a different measurement, not a slower one. A report that
    /// cannot say which build produced it cannot be defended, so the build says so itself.
    /// </summary>
    [Fact]
    public void SaysWhichBuildItIsAndWarnsWhenThatBuildCannotCarryABenchmark()
    {
        FakeLogger logger = new();

        StartupSummary.Log(logger, 1, 1, 1, "Continuous", "127.0.0.1:0");

        IReadOnlyList<FakeLogRecord> records = logger.Collector.GetSnapshot();
        records[0].Message.ShouldContain($"build={StartupSummary.BuildConfiguration}");

        if (StartupSummary.IsBenchmarkableBuild)
        {
            records.Count.ShouldBe(1);
        }
        else
        {
            records.Count.ShouldBe(2);
            records[1].Level.ShouldBe(LogLevel.Warning);
            records[1].Message.ShouldContain("must not be quoted in a benchmark");
        }
    }
}
