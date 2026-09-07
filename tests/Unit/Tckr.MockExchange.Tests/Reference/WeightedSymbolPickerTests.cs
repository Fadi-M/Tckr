using System.Runtime.CompilerServices;
using Tckr.MockExchange.Reference;
using Xunit.Abstractions;

namespace Tckr.MockExchange.Tests.Reference;

public class WeightedSymbolPickerTests(ITestOutputHelper output)
{
    private const int Draws = 1_000_000;
    private const ulong UniverseSeed = 0xC0FFEE_1234_5678UL;
    private const ulong DrawSeed = 0x5EED_0F_A11A5;

    [Fact]
    public void Constructor_RejectsAnEmptyWeightVector()
        => Should.Throw<ArgumentException>(() => new WeightedSymbolPicker(ReadOnlySpan<double>.Empty));

    [Theory]
    [InlineData(0d)]
    [InlineData(-1d)]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    public void Constructor_RejectsAnUnusableWeight(double weight)
    {
        var weights = new[] { 1d, weight, 1d };

        var exception = Should.Throw<ArgumentException>(() => new WeightedSymbolPicker(weights));

        exception.Message.ShouldContain("index 1");
    }

    [Fact]
    public void SingleSymbol_IsAlwaysSelected()
    {
        var picker = new WeightedSymbolPicker([1d]);
        var random = new DeterministicRandom(DrawSeed);

        picker.Count.ShouldBe(1);
        for (var i = 0; i < 10_000; i++)
        {
            picker.Next(random.NextUInt64()).ShouldBe(0);
        }
    }

    [Fact]
    public void Next_AlwaysReturnsAnIndexInsideTheUniverse()
    {
        var picker = new WeightedSymbolPicker([5d, 1d, 3d, 0.001d]);
        var random = new DeterministicRandom(DrawSeed);

        for (var i = 0; i < 100_000; i++)
        {
            var index = picker.Next(random.NextUInt64());
            index.ShouldBeGreaterThanOrEqualTo(0);
            index.ShouldBeLessThan(picker.Count);
        }
    }

    [Fact]
    public void SmallDistribution_MatchesTheConfiguredWeights()
    {
        double[] weights = [1d, 1d, 2d, 6d];
        var counts = Draw(weights, Draws, DrawSeed);

        // Expected shares: 0.10, 0.10, 0.20, 0.60. With a million draws the sampling error on the
        // smallest bucket is ~0.03%, so 1% relative is a real constraint here.
        for (var i = 0; i < weights.Length; i++)
        {
            var expected = weights[i] / 10d;
            var observed = counts[i] / (double)Draws;
            (Math.Abs(observed - expected) / expected)
                .ShouldBeLessThan(0.01, $"index {i}: expected {expected:P4}, observed {observed:P4}");
        }
    }

    [Fact]
    public void FullUniverse_EverySymbolLandsWithinOnePercentOfItsConfiguredShare()
    {
        var universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, UniverseSeed);
        var counts = Draw(universe.Weights.ToArray(), Draws, DrawSeed);

        var worstAbsolute = 0d;
        for (var i = 0; i < universe.Count; i++)
        {
            var expected = universe.Weights[i];
            var observed = counts[i] / (double)Draws;
            worstAbsolute = Math.Max(worstAbsolute, Math.Abs(observed - expected));
        }

        // "Within +/-1% of configured weights", read as one percentage point of share. The head of
        // a Zipf universe is where a broken alias table shows up, and the head is exactly where
        // this bound is tight relative to the sampling noise.
        output.WriteLine($"worst absolute share deviation {worstAbsolute:P4}");

        worstAbsolute.ShouldBeLessThan(0.01);
    }

    [Fact]
    public void FullUniverse_HasNoSymbolWithASignificantBias()
    {
        var universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, UniverseSeed);
        var counts = Draw(universe.Weights.ToArray(), Draws, DrawSeed);

        // Per-symbol z-score against the binomial standard deviation. A percentage-point bound is
        // vacuous for the tail, where a symbol expects ~21 hits in a million; this is not.
        var worstZ = 0d;
        var worstIndex = 0;
        for (var i = 0; i < universe.Count; i++)
        {
            var expected = universe.Weights[i] * Draws;
            var deviation = Math.Abs(counts[i] - expected) / Math.Sqrt(expected * (1d - universe.Weights[i]));
            if (deviation > worstZ)
            {
                worstZ = deviation;
                worstIndex = i;
            }
        }

        output.WriteLine($"worst per-symbol z = {worstZ:F2} at index {worstIndex}");

        worstZ.ShouldBeLessThan(5d, $"worst offender is index {worstIndex} ({universe[worstIndex].Symbol}).");
    }

    [Fact]
    public void FullUniverse_PassesAChiSquareGoodnessOfFitTest()
    {
        var universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, UniverseSeed);
        var counts = Draw(universe.Weights.ToArray(), Draws, DrawSeed);

        var chiSquare = 0d;
        for (var i = 0; i < universe.Count; i++)
        {
            var expected = universe.Weights[i] * Draws;
            expected.ShouldBeGreaterThan(5d, "chi-square needs every expected count above ~5.");

            var residual = counts[i] - expected;
            chiSquare += residual * residual / expected;
        }

        // For large degrees of freedom chi-square is approximately normal with mean df and
        // variance 2df, so this is a five-sigma bound on the whole 250-way fit.
        var degreesOfFreedom = universe.Count - 1;
        var z = (chiSquare - degreesOfFreedom) / Math.Sqrt(2d * degreesOfFreedom);

        output.WriteLine($"chi-square {chiSquare:F1} on {degreesOfFreedom} df, z = {z:F2}");

        Math.Abs(z).ShouldBeLessThan(5d, $"chi-square {chiSquare:F1} on {degreesOfFreedom} degrees of freedom.");
    }

    [Fact]
    public void FullUniverse_ReproducesTheSkewOfARealTape()
    {
        var universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, UniverseSeed);
        var counts = Draw(universe.Weights.ToArray(), Draws, DrawSeed);

        // The universe is ordered most-active first, so the head is a prefix of the count array.
        var sorted = (long[])counts.Clone();
        Array.Sort(sorted);
        Array.Reverse(sorted);

        var topOne = sorted[0] / (double)Draws;
        var topTen = Share(sorted, 10);
        var topFifty = Share(sorted, 50);

        output.WriteLine($"top-1 {topOne:P2}  top-10 {topTen:P2}  top-50 {topFifty:P2}  (n = {Draws:N0})");

        topOne.ShouldBeInRange(0.10, 0.18);
        topTen.ShouldBeGreaterThanOrEqualTo(0.50);
        topFifty.ShouldBeGreaterThanOrEqualTo(0.85);

        static double Share(long[] descending, int take)
        {
            var total = 0L;
            for (var i = 0; i < take; i++)
            {
                total += descending[i];
            }

            return total / (double)Draws;
        }
    }

    [Fact]
    public void FullUniverse_SelectsEverySymbolAtLeastOnce()
    {
        var universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, UniverseSeed);
        var counts = Draw(universe.Weights.ToArray(), Draws, DrawSeed);

        var rarest = counts.Min();
        output.WriteLine($"rarest symbol drawn {rarest:N0} times in {Draws:N0}");

        for (var i = 0; i < counts.Length; i++)
        {
            counts[i].ShouldBeGreaterThan(0L, $"'{universe[i].Symbol}' never appeared in {Draws:N0} draws.");
        }
    }

    [Fact]
    public void Next_AllocatesNothing()
    {
        var universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, UniverseSeed);
        var picker = universe.CreatePicker();

        // Warm up so JIT compilation and any first-call bookkeeping are outside the measurement.
        Spin(picker, 10_000, DrawSeed);

        var before = GC.GetAllocatedBytesForCurrentThread();
        Spin(picker, 100_000, DrawSeed);
        var after = GC.GetAllocatedBytesForCurrentThread();

        (after - before).ShouldBe(0L);
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static int Spin(WeightedSymbolPicker picker, int draws, ulong seed)
    {
        var random = new DeterministicRandom(seed);
        var sink = 0;
        for (var i = 0; i < draws; i++)
        {
            sink += picker.Next(random.NextUInt64());
        }

        return sink;
    }

    private static long[] Draw(double[] weights, int draws, ulong seed)
    {
        var picker = new WeightedSymbolPicker(weights);
        var random = new DeterministicRandom(seed);
        var counts = new long[weights.Length];

        for (var i = 0; i < draws; i++)
        {
            counts[picker.Next(random.NextUInt64())]++;
        }

        return counts;
    }
}
