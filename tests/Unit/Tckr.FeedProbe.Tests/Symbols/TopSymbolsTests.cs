using System.Buffers;
using System.Diagnostics;
using Tckr.FeedProbe.Tests.Support;

namespace Tckr.FeedProbe.Tests.Symbols;

/// <summary>
/// <see cref="ProbeSession.BuildTopSymbols"/> and <see cref="ProbeSession.PercentOfTop"/> — the
/// top-1/top-10/top-50 share computation the DoD's "&#8805;50% skew" check depends on. Populated
/// through real tick frames via <see cref="ProbeSession.ProcessBuffer"/> rather than reaching into
/// <c>SymbolTable</c> directly, so the test exercises the same path a live run does.
/// </summary>
public class TopSymbolsTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.UtcNow;

    [Fact]
    public void UniverseSmallerThanTenIncludesEveryoneInTopTenAndTopFifty()
    {
        ProbeSession session = NewSession(topSymbols: 20);
        ulong seq = 1;
        Feed(session, "AAA", 5, ref seq);
        Feed(session, "BBB", 3, ref seq);
        Feed(session, "CCC", 2, ref seq);

        IReadOnlyList<SymbolShare> top = session.BuildTopSymbols(out double top1, out double top10, out double top50);

        top.Count.ShouldBe(3);
        top1.ShouldBe(50.0);   // 5 of 10
        top10.ShouldBe(100.0); // all 3 symbols, since the universe has fewer than 10
        top50.ShouldBe(100.0);

        top[0].Symbol.ShouldBe("AAA");
        top[0].Count.ShouldBe(5L);
        top[0].SharePercent.ShouldBe(50.0);
        top[1].Symbol.ShouldBe("BBB");
        top[1].SharePercent.ShouldBe(30.0);
        top[2].Symbol.ShouldBe("CCC");
        top[2].SharePercent.ShouldBe(20.0);
    }

    [Fact]
    public void ATieAtTheTopTenBoundaryStillProducesADeterministicPercentage()
    {
        // Nine distinct counts plus a tied pair (2 and 2) straddling the 10th/11th rank. Because
        // the two tied symbols have *equal* counts, top10Percent is the same no matter which one
        // Array.Sort (which is not a stable sort) happens to place 10th vs. 11th — the sum of the
        // first ten is invariant to that ordering.
        ProbeSession session = NewSession(topSymbols: 20);
        ulong seq = 1;
        int[] counts = [18, 16, 14, 12, 10, 8, 6, 4, 3];
        for (int i = 0; i < counts.Length; i++)
        {
            Feed(session, $"S{i}", counts[i], ref seq);
        }

        Feed(session, "TIE1", 2, ref seq);
        Feed(session, "TIE2", 2, ref seq);

        IReadOnlyList<SymbolShare> top = session.BuildTopSymbols(out double top1, out double top10, out double top50);

        const int total = 18 + 16 + 14 + 12 + 10 + 8 + 6 + 4 + 3 + 2 + 2; // 95
        const double expectedTop10 = 100.0 * (18 + 16 + 14 + 12 + 10 + 8 + 6 + 4 + 3 + 2) / total; // 93 of 95

        top1.ShouldBe(100.0 * 18 / total);
        top10.ShouldBe(expectedTop10, tolerance: 1e-9);
        top50.ShouldBe(100.0); // only 11 symbols total

        top.Count.ShouldBe(11); // topSymbols default of 20, clamped to the actual universe
        top.Sum(s => s.SharePercent).ShouldBe(100.0, tolerance: 1e-6);
    }

    [Fact]
    public void TopSymbolsListIsClampedByTheTopSymbolsOption()
    {
        ProbeSession session = NewSession(topSymbols: 2);
        ulong seq = 1;
        Feed(session, "AAA", 5, ref seq);
        Feed(session, "BBB", 3, ref seq);
        Feed(session, "CCC", 2, ref seq);

        IReadOnlyList<SymbolShare> top = session.BuildTopSymbols(out _, out _, out _);

        top.Count.ShouldBe(2);
        top[0].Symbol.ShouldBe("AAA");
        top[1].Symbol.ShouldBe("BBB");
    }

    [Fact]
    public void NoEventsProducesZeroSharesAndAnEmptyList()
    {
        ProbeSession session = NewSession(topSymbols: 20);

        IReadOnlyList<SymbolShare> top = session.BuildTopSymbols(out double top1, out double top10, out double top50);

        top.ShouldBeEmpty();
        top1.ShouldBe(0);
        top10.ShouldBe(0);
        top50.ShouldBe(0);
    }

    private static ProbeSession NewSession(int topSymbols) => new(new ProbeOptions { TopSymbols = topSymbols });

    private static void Feed(ProbeSession session, string symbol, int count, ref ulong seq)
    {
        var frames = new byte[count][];
        for (int i = 0; i < count; i++)
        {
            frames[i] = WireFrame.Tick(seq++, symbol: symbol);
        }

        byte[] all = WireFrame.Concat(frames);
        var buffer = new ReadOnlySequence<byte>(all);
        session.ProcessBuffer(ref buffer, Stopwatch.GetTimestamp(), 0, Now);
    }
}
