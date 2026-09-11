using Microsoft.Extensions.Logging;

namespace Tckr.MockExchange.Diagnostics;

/// <summary>
/// The one line that makes a run reproducible from its log: seed, universe, target, mode,
/// endpoint, and the build configuration it was compiled in.
/// </summary>
/// <remarks>
/// The build configuration is the part that is easy to leave out and expensive to leave out.
/// Throughput taken from a <c>DEBUG</c> build is not a slower version of the real number, it is a
/// different measurement &#8212; no inlining, no tiered promotion, bounds checks the JIT would
/// have elided &#8212; and a benchmark report that does not say which one it was cannot be
/// defended. Detecting it here rather than at each call site keeps the one conditional-compilation
/// block in the codebase in a single place.
/// </remarks>
internal static class StartupSummary
{
    /// <summary>The configuration this assembly was compiled in.</summary>
    internal const string BuildConfiguration =
#if DEBUG
        "DEBUG";
#else
        "RELEASE";
#endif

    /// <summary>True when throughput measured from this build should not be quoted.</summary>
    internal static bool IsBenchmarkableBuild => BuildConfiguration == "RELEASE";

    /// <summary>Logs the start-up line, and a warning if the build cannot carry a benchmark.</summary>
    /// <param name="logger">Destination.</param>
    /// <param name="seed">Generator seed; two runs with the same seed produce the same tape. A
    /// <see cref="ulong"/> because that is the width the generator's RNG is seeded at: an int here
    /// would truncate the value the line exists to make reproducible.</param>
    /// <param name="symbolCount">Size of the symbol universe.</param>
    /// <param name="targetEventsPerSecond">Configured base rate, before phase multipliers.</param>
    /// <param name="sessionMode">Market-session mode, e.g. <c>CompressedDay</c>.</param>
    /// <param name="listenEndpoint">The bound endpoint, read back after binding rather than from configuration.</param>
    internal static void Log(
        ILogger logger,
        ulong seed,
        int symbolCount,
        double targetEventsPerSecond,
        string sessionMode,
        string listenEndpoint)
    {
        ArgumentNullException.ThrowIfNull(logger);

        logger.LogInformation(
            "Mock exchange starting: seed={Seed} symbols={SymbolCount} target={TargetRate:F0}/s mode={SessionMode} listen={ListenEndpoint} build={BuildConfiguration}.",
            seed,
            symbolCount,
            targetEventsPerSecond,
            sessionMode,
            listenEndpoint,
            BuildConfiguration);

        if (!IsBenchmarkableBuild)
        {
            logger.LogWarning(
                "This is a {BuildConfiguration} build. Throughput and latency measured from it are not comparable to a Release run and must not be quoted in a benchmark.",
                BuildConfiguration);
        }
    }
}
