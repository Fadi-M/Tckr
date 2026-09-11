using Tckr.MockExchange.Generation;
using Xunit.Abstractions;

namespace Tckr.MockExchange.Tests.Generation;

public class Xoshiro256StarStarTests(ITestOutputHelper output)
{
    private const ulong Seed = 0x5EED_0F_A11A5UL;

    /// <summary>
    /// The first four draws for seed <c>0</c>.
    /// </summary>
    /// <remarks>
    /// A regression guard on the stream itself, not on the algorithm: xoshiro256** is standard,
    /// but the seeding is ours, and a change to either silently reshapes every benchmark tape ever
    /// captured. Recorded from this implementation on the day it was written. If it fails, the
    /// question is not "is the new stream also fine" but "is every previously published benchmark
    /// number still comparable".
    /// </remarks>
    private static readonly ulong[] SeedZeroPrefix =
    [
        0x99EC5F36CB75F2B4UL,
        0xBF6E1F784956452AUL,
        0x1A5F849D4933E6E0UL,
        0x6AA594F1262D2D2CUL,
    ];

    [Fact]
    public void SeedZero_ProducesTheRecordedStream()
    {
        var rng = new Xoshiro256StarStar(0);

        for (int i = 0; i < SeedZeroPrefix.Length; i++)
        {
            ulong actual = rng.NextUInt64();
            output.WriteLine($"[{i}] 0x{actual:X16}");
            actual.ShouldBe(SeedZeroPrefix[i], $"draw {i} of the seed-0 stream changed");
        }
    }

    [Fact]
    public void SameSeed_ProducesTheSameStream()
    {
        var left = new Xoshiro256StarStar(Seed);
        var right = new Xoshiro256StarStar(Seed);

        for (int i = 0; i < 10_000; i++)
        {
            left.NextUInt64().ShouldBe(right.NextUInt64());
        }
    }

    [Fact]
    public void AdjacentSeeds_ProduceUnrelatedStreams()
    {
        // The point of SplitMix64 seeding: seeds that differ by one must not produce streams that
        // differ by one. A naive "drop the seed into s0" would fail this badly.
        var left = new Xoshiro256StarStar(0);
        var right = new Xoshiro256StarStar(1);

        int identical = 0;
        for (int i = 0; i < 1_000; i++)
        {
            if (left.NextUInt64() == right.NextUInt64())
            {
                identical++;
            }
        }

        identical.ShouldBe(0);
    }

    [Fact]
    public void ZeroSeed_DoesNotProduceTheAllZeroState()
    {
        // The all-zero state is xoshiro's fixed point: it would emit zero for ever, and the tape
        // would be one symbol at one price rather than an exception anyone would notice.
        var rng = new Xoshiro256StarStar(0);

        bool anyNonZero = false;
        for (int i = 0; i < 64; i++)
        {
            anyNonZero |= rng.NextUInt64() != 0;
        }

        anyNonZero.ShouldBeTrue();
    }

    [Fact]
    public void NextDouble_StaysInsideTheUnitInterval()
    {
        var rng = new Xoshiro256StarStar(Seed);

        double min = double.MaxValue;
        double max = double.MinValue;
        double sum = 0;
        const int draws = 1_000_000;

        for (int i = 0; i < draws; i++)
        {
            double value = rng.NextDouble();
            value.ShouldBeGreaterThanOrEqualTo(0d);
            value.ShouldBeLessThan(1d);
            min = Math.Min(min, value);
            max = Math.Max(max, value);
            sum += value;
        }

        output.WriteLine($"min {min:F9}  max {max:F9}  mean {sum / draws:F6}");
        (sum / draws).ShouldBe(0.5, 0.002);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(7)]
    [InlineData(20)]
    public void NextInt_IsUniformOverItsRange(int exclusiveMax)
    {
        var rng = new Xoshiro256StarStar(Seed);
        int[] counts = new int[exclusiveMax];
        const int draws = 1_000_000;

        for (int i = 0; i < draws; i++)
        {
            int value = rng.NextInt(exclusiveMax);
            value.ShouldBeGreaterThanOrEqualTo(0);
            value.ShouldBeLessThan(exclusiveMax);
            counts[value]++;
        }

        // Tolerance is set from the sampling error, not from a round number: with a million draws
        // over twenty buckets one standard deviation is already 0.44% of a bucket, so a 1% bound
        // would fail roughly one run in fifty for no reason. Five sigma is a real constraint on the
        // generator and a non-constraint on luck.
        double expected = draws / (double)exclusiveMax;
        // The floor keeps a single-outcome range, whose sampling error is exactly zero, from
        // asserting that zero is less than zero.
        double tolerance = Math.Max(5 * Math.Sqrt(expected * (1 - (1d / exclusiveMax))) / expected, 1e-9);
        output.WriteLine($"{exclusiveMax} outcomes, tolerance {tolerance:P3}");

        for (int i = 0; i < exclusiveMax; i++)
        {
            (Math.Abs(counts[i] - expected) / expected)
                .ShouldBeLessThan(tolerance, $"outcome {i} of {exclusiveMax} appeared {counts[i]} times");
        }
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void NextInt_RejectsAnEmptyRange(int exclusiveMax)
    {
        var rng = new Xoshiro256StarStar(Seed);

        Should.Throw<ArgumentOutOfRangeException>(() => rng.NextInt(exclusiveMax));
    }

    [Fact]
    public void EveryBitPosition_IsSetAboutHalfTheTime()
    {
        // The hot path slices one 64-bit draw into independent fields, so a weak bit anywhere in
        // the word would quietly bias whichever field happens to sit on it.
        var rng = new Xoshiro256StarStar(Seed);
        int[] setCount = new int[64];
        const int draws = 200_000;

        for (int i = 0; i < draws; i++)
        {
            ulong value = rng.NextUInt64();
            for (int bit = 0; bit < 64; bit++)
            {
                setCount[bit] += (int)((value >> bit) & 1);
            }
        }

        for (int bit = 0; bit < 64; bit++)
        {
            (setCount[bit] / (double)draws)
                .ShouldBe(0.5, 0.01, $"bit {bit} was set {setCount[bit]} times in {draws} draws");
        }
    }
}
