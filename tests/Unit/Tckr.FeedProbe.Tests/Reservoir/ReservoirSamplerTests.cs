namespace Tckr.FeedProbe.Tests.Reservoir;

/// <summary>
/// <see cref="ReservoirSampler"/>: fills in order below capacity, and — the property Algorithm R
/// exists to guarantee — samples uniformly once the stream exceeds capacity.
/// </summary>
public class ReservoirSamplerTests
{
    [Fact]
    public void BelowCapacityKeepsEveryValueInArrivalOrder()
    {
        var sampler = new ReservoirSampler(capacity: 10, seed: 1);

        for (long i = 0; i < 5; i++)
        {
            sampler.Add(i * 10);
        }

        sampler.TotalSeen.ShouldBe(5L);
        sampler.Snapshot().ShouldBe([0L, 10L, 20L, 30L, 40L]);
    }

    [Fact]
    public void ExactlyAtCapacityKeepsEveryValue()
    {
        var sampler = new ReservoirSampler(capacity: 4, seed: 1);

        for (long i = 0; i < 4; i++)
        {
            sampler.Add(i);
        }

        sampler.TotalSeen.ShouldBe(4L);
        sampler.Snapshot().ShouldBe([0L, 1L, 2L, 3L]);
    }

    [Fact]
    public void SnapshotIsACopyNotALiveView()
    {
        var sampler = new ReservoirSampler(capacity: 3, seed: 1);
        sampler.Add(1);
        sampler.Add(2);

        long[] snapshot = sampler.Snapshot();
        sampler.Add(3);

        snapshot.ShouldBe([1L, 2L]);
    }

    /// <summary>
    /// Above capacity, Algorithm R must keep every element seen so far equally likely to survive.
    /// Verified statistically: run many independent, seeded trials of a small reservoir over a
    /// longer stream, and check that each original index's survival frequency across trials sits
    /// close to capacity/streamLength. Deterministic — every trial uses an explicit seed, no time-
    /// derived randomness and no wall-clock dependency.
    /// </summary>
    [Fact]
    public void SamplingAboveCapacityIsApproximatelyUniformAcrossManySeededTrials()
    {
        const int capacity = 5;
        const int streamLength = 50;
        const int trials = 3000;

        var selectionCount = new int[streamLength];

        for (int trial = 0; trial < trials; trial++)
        {
            var sampler = new ReservoirSampler(capacity, seed: trial);
            for (long i = 0; i < streamLength; i++)
            {
                sampler.Add(i); // the value *is* the original index
            }

            foreach (long survivor in sampler.Snapshot())
            {
                selectionCount[survivor]++;
            }
        }

        double expectedPerIndex = trials * ((double)capacity / streamLength); // 300
        double lowerBound = expectedPerIndex * 0.5;   // 150 — ~9 standard deviations of slack
        double upperBound = expectedPerIndex * 1.5;   // 450

        foreach (int count in selectionCount)
        {
            count.ShouldBeGreaterThanOrEqualTo((int)lowerBound);
            count.ShouldBeLessThanOrEqualTo((int)upperBound);
        }

        // And the reservoir always stays exactly at capacity once the stream exceeds it.
        selectionCount.Sum().ShouldBe(trials * capacity);
    }

    [Fact]
    public void TotalSeenCountsEveryOfferedValueNotJustSurvivors()
    {
        var sampler = new ReservoirSampler(capacity: 2, seed: 42);
        for (int i = 0; i < 100; i++)
        {
            sampler.Add(i);
        }

        sampler.TotalSeen.ShouldBe(100L);
        sampler.Snapshot().Length.ShouldBe(2);
    }

    [Fact]
    public void ZeroCapacityIsRejected()
    {
        Should.Throw<ArgumentOutOfRangeException>(() => new ReservoirSampler(capacity: 0));
    }

    [Fact]
    public void SameSeedProducesTheSameSampleGivenTheSameStream()
    {
        long[] SampleWithSeed(int seed)
        {
            var sampler = new ReservoirSampler(capacity: 5, seed: seed);
            for (long i = 0; i < 200; i++)
            {
                sampler.Add(i);
            }

            return sampler.Snapshot();
        }

        SampleWithSeed(123).ShouldBe(SampleWithSeed(123));
    }
}
