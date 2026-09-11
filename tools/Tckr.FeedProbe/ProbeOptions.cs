namespace Tckr.FeedProbe;

/// <summary>Malformed or unknown command-line input. Caught in <c>Program.cs</c> and reported to stderr.</summary>
internal sealed class ProbeArgumentException(string message) : Exception(message);

/// <summary>
/// Parsed command-line configuration for a single probe run.
/// </summary>
/// <remarks>
/// The task brief specifies six flags plus <c>--stall-after</c>. Three more exist here that the
/// brief does not name:
/// <list type="bullet">
/// <item><description>
/// <see cref="TargetEventsPerSecond"/> &#8212; the brief's own sample output prints
/// <c>(target 25,000 — 99.9%)</c> and the exit-code contract needs an "outside &#177;2% of target"
/// comparison, but no flag in the brief's table supplies that number. Defaulted to 25,000, which is
/// <c>Session:BaseEventsPerSecond</c>'s own default, so a probe run against an unconfigured exchange
/// compares against the number the exchange is actually pacing to.
/// </description></item>
/// <item><description>
/// <see cref="ExpectDrops"/> &#8212; how the probe learns which slow-consumer policy is in force. See
/// the remarks on <see cref="ProbeSession"/> for the reasoning: a gap is a failure under the default
/// <c>Disconnect</c> policy and documented, expected disclosure under <c>DropOldest</c>, and the wire
/// carries no signal telling the probe which policy the server is running. This flag is how an
/// operator (or task 09) tells it.
/// </description></item>
/// <item><description>
/// <see cref="StallDurationSeconds"/> &#8212; how long <c>--stall-after</c> stops reading before
/// resuming. Without a resume, a stall test only ever proves "the server eventually gives up on a
/// consumer that never reads again", which is a weaker claim than the acceptance criterion asks for
/// (reproducing the disconnect, observably, within one run). Defaults to five seconds: comfortably
/// past the server's default 2,000&#8239;ms <c>SlowConsumerTimeoutMs</c>, so a default-policy run
/// reliably crosses into either a clean disconnect or a resolved drop before reading resumes.
/// </description></item>
/// </list>
/// Hand-rolled rather than <c>System.CommandLine</c>: nine scalar flags, no subcommands, no
/// completion or help-generation needs beyond a single usage line. A dependency earns its place by
/// removing more complexity than a straightforward switch adds; here it would not.
/// </remarks>
internal sealed record ProbeOptions
{
    internal const int DefaultPort = 9001;
    internal const int DefaultDurationSeconds = 60;
    internal const int DefaultReportIntervalSeconds = 5;
    internal const int DefaultTopSymbols = 20;
    internal const double DefaultTargetEventsPerSecond = 25_000;
    internal const int DefaultStallDurationSeconds = 5;

    internal string Host { get; init; } = "localhost";
    internal int Port { get; init; } = DefaultPort;

    /// <summary>Seconds to run; 0 means until Ctrl+C.</summary>
    internal int DurationSeconds { get; init; } = DefaultDurationSeconds;

    internal int ReportIntervalSeconds { get; init; } = DefaultReportIntervalSeconds;
    internal string? OutputPath { get; init; }
    internal int TopSymbols { get; init; } = DefaultTopSymbols;
    internal bool VerifyOrder { get; init; }

    /// <summary>Seconds after connecting at which the probe stops reading, to test the slow-consumer policy.</summary>
    internal int? StallAfterSeconds { get; init; }

    /// <summary>How long the pause from <see cref="StallAfterSeconds"/> lasts before reading resumes.</summary>
    internal int StallDurationSeconds { get; init; } = DefaultStallDurationSeconds;

    /// <summary>The rate this run is measured against for the &#177;2% pass/fail check.</summary>
    internal double TargetEventsPerSecond { get; init; } = DefaultTargetEventsPerSecond;

    /// <summary>
    /// True when the server is known to run <c>SlowConsumerPolicy.DropOldest</c>, so an observed
    /// sequence gap is the documented disclosure of a drop rather than a correctness failure.
    /// </summary>
    internal bool ExpectDrops { get; init; }

    internal static ProbeOptions Parse(string[] args)
    {
        string host = "localhost";
        int port = DefaultPort;
        int duration = DefaultDurationSeconds;
        int reportInterval = DefaultReportIntervalSeconds;
        string? output = null;
        int topSymbols = DefaultTopSymbols;
        bool verifyOrder = false;
        int? stallAfter = null;
        int stallDuration = DefaultStallDurationSeconds;
        double targetRate = DefaultTargetEventsPerSecond;
        bool expectDrops = false;

        int i = 0;
        while (i < args.Length)
        {
            (string flag, string? inlineValue) = SplitFlag(args[i]);
            int flagIndex = i;

            string Value()
            {
                if (inlineValue is not null)
                {
                    return inlineValue;
                }

                flagIndex++;
                if (flagIndex >= args.Length)
                {
                    throw new ProbeArgumentException($"'{flag}' expects a value.");
                }

                return args[flagIndex];
            }

            switch (flag)
            {
                case "--host": host = Value(); break;
                case "--port": port = ParseInt(flag, Value()); break;
                case "--duration": duration = ParseInt(flag, Value()); break;
                case "--report-interval": reportInterval = ParseInt(flag, Value()); break;
                case "--output": output = Value(); break;
                case "--top-symbols": topSymbols = ParseInt(flag, Value()); break;
                case "--verify-order": verifyOrder = true; break;
                case "--stall-after": stallAfter = ParseInt(flag, Value()); break;
                case "--stall-duration": stallDuration = ParseInt(flag, Value()); break;
                case "--target-rate": targetRate = ParseDouble(flag, Value()); break;
                case "--expect-drops": expectDrops = true; break;
                default:
                    throw new ProbeArgumentException(
                        $"Unknown flag '{flag}'. Run with --help to see the supported flags.");
            }

            i = flagIndex + 1;
        }

        if (string.IsNullOrWhiteSpace(host))
        {
            throw new ProbeArgumentException("--host must not be empty.");
        }

        if (port is < 1 or > 65535)
        {
            throw new ProbeArgumentException("--port must be a valid TCP port (1-65535).");
        }

        if (duration < 0)
        {
            throw new ProbeArgumentException("--duration must be >= 0 (0 means run until Ctrl+C).");
        }

        if (reportInterval <= 0)
        {
            throw new ProbeArgumentException("--report-interval must be > 0.");
        }

        if (topSymbols <= 0)
        {
            throw new ProbeArgumentException("--top-symbols must be > 0.");
        }

        if (stallAfter is < 0)
        {
            throw new ProbeArgumentException("--stall-after must be >= 0.");
        }

        if (stallDuration <= 0)
        {
            throw new ProbeArgumentException("--stall-duration must be > 0.");
        }

        if (targetRate <= 0)
        {
            throw new ProbeArgumentException("--target-rate must be > 0.");
        }

        return new ProbeOptions
        {
            Host = host,
            Port = port,
            DurationSeconds = duration,
            ReportIntervalSeconds = reportInterval,
            OutputPath = output,
            TopSymbols = topSymbols,
            VerifyOrder = verifyOrder,
            StallAfterSeconds = stallAfter,
            StallDurationSeconds = stallDuration,
            TargetEventsPerSecond = targetRate,
            ExpectDrops = expectDrops,
        };
    }

    internal static string Usage =>
        """
        Tckr.FeedProbe — independent verification client for the Tckr.MockExchange feed.

        Usage:
          dotnet run --project tools/Tckr.FeedProbe -- [options]

        Options:
          --host <name>              Feed host                          (default: localhost)
          --port <n>                 Feed port                          (default: 9001)
          --duration <seconds>       Seconds to run; 0 = until Ctrl+C    (default: 60)
          --report-interval <sec>    Console summary cadence, seconds    (default: 5)
          --output <path>            Write the final report as JSON here
          --top-symbols <n>          Symbols in the distribution table   (default: 20)
          --verify-order             Assert per-symbol timestamp monotonicity
          --stall-after <seconds>    Stop reading after N seconds, to test the slow-consumer policy
          --stall-duration <seconds> How long that pause lasts           (default: 5)
          --target-rate <events/s>   Rate the achieved-rate check compares against (default: 25000)
          --expect-drops             The server runs DropOldest; a sequence gap is not a failure

        Exit codes: 0 pass, 1 sequence gaps or framing errors, 2 achieved rate outside +/-2% of
        target, 3 connection failure. Malformed command-line arguments exit 64.
        """;

    private static (string Flag, string? InlineValue) SplitFlag(string arg)
    {
        int eq = arg.IndexOf('=');
        return eq < 0 ? (arg, null) : (arg[..eq], arg[(eq + 1)..]);
    }

    private static int ParseInt(string flag, string value)
    {
        if (!int.TryParse(value, out int parsed))
        {
            throw new ProbeArgumentException($"'{flag}' expects an integer; got '{value}'.");
        }

        return parsed;
    }

    private static double ParseDouble(string flag, string value)
    {
        if (!double.TryParse(value, out double parsed))
        {
            throw new ProbeArgumentException($"'{flag}' expects a number; got '{value}'.");
        }

        return parsed;
    }
}
