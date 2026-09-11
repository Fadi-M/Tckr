using System.Diagnostics;
using Tckr.MockExchange.Generation;
using Tckr.MockExchange.Options;
using Tckr.MockExchange.Protocol;
using Tckr.MockExchange.Reference;
using Xunit.Abstractions;

namespace Tckr.MockExchange.Tests.Generation;

/// <summary>
/// What the generator costs when nothing paces it.
/// </summary>
/// <remarks>
/// <para>
/// The floor is 1,000,000 events/sec single-threaded, which is forty times the Phase 2 target of
/// 25,000. The margin is the point. A generator that could only just reach 25,000 would have the
/// rate governor waiting on it rather than the other way round, and the achieved rate would then
/// measure this code instead of the pacing loop &#8212; which would make every downstream
/// throughput number a measurement of the wrong thing.
/// </para>
/// <para>
/// Skipped in Debug, following <c>Session/RateGovernorBenchmarkTests</c>: an unoptimised build
/// measures the debugger's arithmetic, not the generator's, and a wall-clock assertion that fails
/// for that reason is worse than one taken on purpose. Run it with
/// <c>dotnet test -c Release --filter Category=Benchmark</c>.
/// </para>
/// </remarks>
[Trait("Category", "Benchmark")]
public class RandomWalkGeneratorBenchmarkTests(ITestOutputHelper output)
{
    private const ulong UniverseSeed = 0xC0FFEE_1234_5678UL;
    private const int BatchSize = 4096;
    private const int Events = 20_000_000;
    private const double FloorEventsPerSecond = 1_000_000;

#if DEBUG
    [Fact(Skip = "Wall-clock measurement; run with: dotnet test -c Release --filter Category=Benchmark")]
#else
    [Fact]
#endif
    public void GeneratesAtLeastAMillionEventsPerSecondOnOneThread()
    {
        SymbolUniverse universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, UniverseSeed);
        IMarketDataGenerator generator = new RandomWalkGenerator(universe, new GenerationOptions());
        FeedRecord[] buffer = new FeedRecord[BatchSize];

        // Tiered JIT promotes the loop after a few thousand calls; measuring before that measures
        // the tier-0 code, which nothing in production ever runs for long.
        for (int i = 0; i < 200; i++)
        {
            generator.Generate(buffer);
        }

        int batches = Events / BatchSize;
        int gen0Before = GC.CollectionCount(0);
        long allocatedBefore = GC.GetAllocatedBytesForCurrentThread();

        long start = Stopwatch.GetTimestamp();
        for (int i = 0; i < batches; i++)
        {
            generator.Generate(buffer);
        }

        TimeSpan elapsed = Stopwatch.GetElapsedTime(start);

        long allocated = GC.GetAllocatedBytesForCurrentThread() - allocatedBefore;
        int gen0 = GC.CollectionCount(0) - gen0Before;

        int generated = batches * BatchSize;
        double perSecond = generated / elapsed.TotalSeconds;
        double nanosPerEvent = elapsed.TotalMilliseconds * 1_000_000 / generated;

        output.WriteLine($"events        : {generated:N0}");
        output.WriteLine($"elapsed       : {elapsed.TotalSeconds:F3} s");
        output.WriteLine($"throughput    : {perSecond:N0} events/sec (floor {FloorEventsPerSecond:N0})");
        output.WriteLine($"per event     : {nanosPerEvent:F1} ns");
        output.WriteLine($"headroom      : {perSecond / 25_000:N1}x the 25,000/sec target");
        output.WriteLine($"allocated     : {allocated} bytes");
        output.WriteLine($"gen0 collects : {gen0}");

        perSecond.ShouldBeGreaterThan(
            FloorEventsPerSecond, $"generated {perSecond:N0} events/sec against a floor of {FloorEventsPerSecond:N0}");

        // Throughput and allocation are the same measurement viewed twice: steady-state garbage is
        // what turns a fast loop into a slow one under a real GC.
        allocated.ShouldBe(0L, $"generating {generated:N0} events allocated {allocated} bytes");
    }
}
