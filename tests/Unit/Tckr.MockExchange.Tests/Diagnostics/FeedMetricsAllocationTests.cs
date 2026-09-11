using Tckr.MockExchange.Diagnostics;

namespace Tckr.MockExchange.Tests.Diagnostics;

/// <summary>
/// The batch path must not allocate.
/// </summary>
/// <remarks>
/// <para>
/// Not a style rule. Steady-state GC pressure from the load source lands in every downstream
/// latency histogram Phase 4 onward produces, and it lands there as a tail the ingestion service
/// did not cause. A generator that allocates is a generator that measures itself.
/// </para>
/// <para>
/// Run against the real <see cref="TimeProvider"/> and with no listener attached, because that is
/// the configuration the exchange runs in. A <c>MetricCollector</c> allocates by design &#8212; it
/// keeps every measurement &#8212; so a test that asserted zero bytes with one attached would be
/// asserting something false about a configuration that never runs.
/// </para>
/// </remarks>
public class FeedMetricsAllocationTests
{
    private const int Iterations = 100_000;

    [Fact]
    public void OneHundredThousandBatchesAllocateNothing()
    {
        using FeedMetrics metrics = new();

        // Warm up: JIT the whole call tree and let the rolling window take its first bucket, so
        // the measured loop is steady state rather than start-up.
        for (int i = 0; i < 1_000; i++)
        {
            metrics.RecordBatch(125);
        }

        GC.Collect();
        GC.WaitForPendingFinalizers();

        long before = GC.GetAllocatedBytesForCurrentThread();

        for (int i = 0; i < Iterations; i++)
        {
            metrics.RecordBatch(125);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;

        allocated.ShouldBe(0, $"{Iterations} batches allocated {allocated} bytes.");
    }

    /// <summary>
    /// The other two per-batch calls, held to the same bar. The publisher loop makes all three per
    /// batch, so a zero-allocation <see cref="FeedMetrics.RecordBatch"/> beside an allocating
    /// <see cref="FeedMetrics.RecordPacingLag"/> would prove nothing.
    /// </summary>
    [Fact]
    public void TheRestOfThePerBatchPathAllocatesNothingEither()
    {
        using FeedMetrics metrics = new();

        for (int i = 0; i < 1_000; i++)
        {
            metrics.RecordPacingLag(TimeSpan.FromMilliseconds(0.4));
            metrics.RecordPublished(125, 1);
            metrics.SetTarget(Tckr.MockExchange.Session.MarketPhase.ContinuousMorning, 25_000);
        }

        GC.Collect();
        GC.WaitForPendingFinalizers();

        long before = GC.GetAllocatedBytesForCurrentThread();

        for (int i = 0; i < Iterations; i++)
        {
            metrics.RecordPacingLag(TimeSpan.FromMilliseconds(0.4));
            metrics.RecordPublished(125, 1);
            metrics.SetTarget(Tckr.MockExchange.Session.MarketPhase.ContinuousMorning, 25_000);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;

        allocated.ShouldBe(0, $"{Iterations} per-batch triples allocated {allocated} bytes.");
    }

    /// <summary>
    /// The publish path's loss counter, measured rather than assumed. It boxes its session id, so
    /// it is <em>not</em> free &#8212; this pins the cost at one small object per refused batch so
    /// that a future change which made it per-record, or added a dictionary behind it, shows up as
    /// a number rather than as a slow benchmark.
    /// </summary>
    [Fact]
    public void RecordsDroppedCostsOneBoxPerRefusedBatch()
    {
        using FeedMetrics metrics = new();
        Guid session = Guid.NewGuid();

        for (int i = 0; i < 1_000; i++)
        {
            metrics.RecordsDropped(session, 125);
        }

        GC.Collect();
        GC.WaitForPendingFinalizers();

        long before = GC.GetAllocatedBytesForCurrentThread();

        for (int i = 0; i < Iterations; i++)
        {
            metrics.RecordsDropped(session, 125);
        }

        long perCall = (GC.GetAllocatedBytesForCurrentThread() - before) / Iterations;

        perCall.ShouldBeLessThanOrEqualTo(48);
    }
}
