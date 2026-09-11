namespace Tckr.FeedProbe.Tests.Cli;

/// <summary>
/// <see cref="ProbeOptions.Parse"/>: every flag, every default, missing/invalid values, and the
/// unknown-flag rejection that becomes exit 64 in <c>Program.cs</c>.
/// </summary>
public class ProbeOptionsParseTests
{
    [Fact]
    public void NoArgumentsProducesTheDocumentedDefaults()
    {
        ProbeOptions options = ProbeOptions.Parse([]);

        options.Host.ShouldBe("localhost");
        options.Port.ShouldBe(9001);
        options.DurationSeconds.ShouldBe(60);
        options.ReportIntervalSeconds.ShouldBe(5);
        options.OutputPath.ShouldBeNull();
        options.TopSymbols.ShouldBe(20);
        options.VerifyOrder.ShouldBeFalse();
        options.StallAfterSeconds.ShouldBeNull();
        options.StallDurationSeconds.ShouldBe(5);
        options.TargetEventsPerSecond.ShouldBe(25_000);
        options.ExpectDrops.ShouldBeFalse();
    }

    [Fact]
    public void EveryFlagSetsItsValue()
    {
        ProbeOptions options = ProbeOptions.Parse(
            [
                "--host", "feed.example.com",
                "--port", "9100",
                "--duration", "30",
                "--report-interval", "2",
                "--output", "/tmp/report.json",
                "--top-symbols", "5",
                "--verify-order",
                "--stall-after", "10",
                "--stall-duration", "3",
                "--target-rate", "12345",
                "--expect-drops",
            ]);

        options.Host.ShouldBe("feed.example.com");
        options.Port.ShouldBe(9100);
        options.DurationSeconds.ShouldBe(30);
        options.ReportIntervalSeconds.ShouldBe(2);
        options.OutputPath.ShouldBe("/tmp/report.json");
        options.TopSymbols.ShouldBe(5);
        options.VerifyOrder.ShouldBeTrue();
        options.StallAfterSeconds.ShouldBe(10);
        options.StallDurationSeconds.ShouldBe(3);
        options.TargetEventsPerSecond.ShouldBe(12345);
        options.ExpectDrops.ShouldBeTrue();
    }

    [Fact]
    public void InlineEqualsSyntaxIsAccepted()
    {
        ProbeOptions options = ProbeOptions.Parse(["--host=feed.example.com", "--port=9100"]);

        options.Host.ShouldBe("feed.example.com");
        options.Port.ShouldBe(9100);
    }

    [Fact]
    public void DurationZeroMeansUntilCtrlCAndIsAccepted()
    {
        ProbeOptions options = ProbeOptions.Parse(["--duration", "0"]);

        options.DurationSeconds.ShouldBe(0);
    }

    [Fact]
    public void StallAfterZeroIsAccepted()
    {
        ProbeOptions options = ProbeOptions.Parse(["--stall-after", "0"]);

        options.StallAfterSeconds.ShouldBe(0);
    }

    // ---- missing values ------------------------------------------------------------------------

    [Theory]
    [InlineData("--host")]
    [InlineData("--port")]
    [InlineData("--duration")]
    [InlineData("--report-interval")]
    [InlineData("--output")]
    [InlineData("--top-symbols")]
    [InlineData("--stall-after")]
    [InlineData("--stall-duration")]
    [InlineData("--target-rate")]
    public void AFlagWithNoValueThrows(string flag)
    {
        ProbeArgumentException ex = Should.Throw<ProbeArgumentException>(() => ProbeOptions.Parse([flag]));
        ex.Message.ShouldContain(flag);
        ex.Message.ShouldContain("expects a value");
    }

    // ---- invalid values --------------------------------------------------------------------------

    [Fact]
    public void ANonIntegerPortThrows()
    {
        ProbeArgumentException ex = Should.Throw<ProbeArgumentException>(() => ProbeOptions.Parse(["--port", "abc"]));
        ex.Message.ShouldContain("--port");
        ex.Message.ShouldContain("integer");
    }

    [Fact]
    public void ANonNumericTargetRateThrows()
    {
        ProbeArgumentException ex = Should.Throw<ProbeArgumentException>(() => ProbeOptions.Parse(["--target-rate", "fast"]));
        ex.Message.ShouldContain("--target-rate");
    }

    [Theory]
    [InlineData(0)]
    [InlineData(65536)]
    [InlineData(-1)]
    public void APortOutsideTheValidRangeThrows(int port)
    {
        Should.Throw<ProbeArgumentException>(() => ProbeOptions.Parse(["--port", port.ToString()]));
    }

    [Fact]
    public void ANegativeDurationThrows()
    {
        Should.Throw<ProbeArgumentException>(() => ProbeOptions.Parse(["--duration", "-1"]));
    }

    [Fact]
    public void AZeroReportIntervalThrows()
    {
        Should.Throw<ProbeArgumentException>(() => ProbeOptions.Parse(["--report-interval", "0"]));
    }

    [Fact]
    public void AZeroTopSymbolsThrows()
    {
        Should.Throw<ProbeArgumentException>(() => ProbeOptions.Parse(["--top-symbols", "0"]));
    }

    [Fact]
    public void ANegativeStallAfterThrows()
    {
        Should.Throw<ProbeArgumentException>(() => ProbeOptions.Parse(["--stall-after", "-1"]));
    }

    [Fact]
    public void AZeroStallDurationThrows()
    {
        Should.Throw<ProbeArgumentException>(() => ProbeOptions.Parse(["--stall-duration", "0"]));
    }

    [Fact]
    public void AZeroTargetRateThrows()
    {
        Should.Throw<ProbeArgumentException>(() => ProbeOptions.Parse(["--target-rate", "0"]));
    }

    [Fact]
    public void AnEmptyHostThrows()
    {
        Should.Throw<ProbeArgumentException>(() => ProbeOptions.Parse(["--host", ""]));
    }

    [Fact]
    public void AWhitespaceOnlyHostThrows()
    {
        Should.Throw<ProbeArgumentException>(() => ProbeOptions.Parse(["--host", "   "]));
    }

    // ---- unknown flag -> the exit-64 usage path in Program.cs ------------------------------------

    [Fact]
    public void AnUnknownFlagThrows()
    {
        ProbeArgumentException ex = Should.Throw<ProbeArgumentException>(() => ProbeOptions.Parse(["--bogus-flag"]));
        ex.Message.ShouldContain("Unknown flag");
        ex.Message.ShouldContain("--bogus-flag");
    }

    [Fact]
    public void PassingHelpDirectlyToParseIsTreatedAsAnUnknownFlag()
    {
        // Program.cs intercepts -h/--help before ever calling Parse (see HelpAndUsageProcessTests);
        // Parse itself has no --help case, so calling it directly with --help must fail the same way
        // any other unrecognised flag would, not silently succeed.
        Should.Throw<ProbeArgumentException>(() => ProbeOptions.Parse(["--help"]));
    }

    [Fact]
    public void UsageTextMentionsEveryDocumentedFlagAndTheExitCodes()
    {
        string usage = ProbeOptions.Usage;

        foreach (string flag in new[]
                 {
                     "--host", "--port", "--duration", "--report-interval", "--output", "--top-symbols",
                     "--verify-order", "--stall-after", "--stall-duration", "--target-rate", "--expect-drops",
                 })
        {
            usage.ShouldContain(flag);
        }

        usage.ShouldContain("Exit codes");
    }
}
