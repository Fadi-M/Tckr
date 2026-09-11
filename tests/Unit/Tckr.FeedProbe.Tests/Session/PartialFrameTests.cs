using System.Buffers;
using System.Diagnostics;
using Tckr.FeedProbe.Tests.Support;

namespace Tckr.FeedProbe.Tests.Session;

/// <summary>
/// A frame the probe receives is split however <c>System.IO.Pipelines</c> happens to hand it over —
/// mid-frame, at any byte offset, sometimes across two separate <c>ReadAsync</c> results. These
/// tests drive <see cref="ProbeSession.ProcessBuffer"/> directly with a synthetic, segmented
/// <see cref="ReadOnlySequence{T}"/>, mirroring
/// <c>Tckr.MockExchange.Tests/Protocol/FeedFrameReaderTests.cs</c>'s approach of parameterising
/// across every split point of a single tick frame.
/// </summary>
public class PartialFrameTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.UtcNow;

    public static TheoryData<int> SplitPoints
    {
        get
        {
            TheoryData<int> data = [];
            for (int i = 1; i < WireFrame.TickFrameSize; i++)
            {
                data.Add(i);
            }

            return data;
        }
    }

    [Theory]
    [MemberData(nameof(SplitPoints))]
    public void ACompleteFrameDecodesNoMatterWhereTheSegmentBoundaryFalls(int splitAt)
    {
        byte[] frame = WireFrame.Tick(1, symbol: "AAPL");
        ReadOnlySequence<byte> buffer = Segmented.Split(frame, splitAt);

        var session = new ProbeSession(new ProbeOptions());
        session.ProcessBuffer(ref buffer, Stopwatch.GetTimestamp(), 0, Now);

        buffer.Length.ShouldBe(0);

        ProbeReport report = session.BuildReport(Now, Now, 1, "duration-elapsed", null, "n/a");
        report.EventsReceived.ShouldBe(1UL);
        report.Gaps.ShouldBeEmpty();
        report.IntegrityViolations.ShouldBeEmpty();
    }

    [Theory]
    [MemberData(nameof(SplitPoints))]
    public void ATruncatedFrameNeedsMoreDataAndLeavesTheBufferUntouched(int availableBytes)
    {
        byte[] frame = WireFrame.Tick(1);
        // Only part of the frame has arrived; split what *has* arrived across two segments so this
        // also covers "not enough bytes yet" when the available prefix itself spans a read boundary.
        int segmentSplit = Math.Max(1, availableBytes / 2);
        var truncated = new ReadOnlySequence<byte>(frame, 0, availableBytes);
        ReadOnlySequence<byte> buffer = segmentSplit < availableBytes
            ? Segmented.Split(truncated.ToArray(), segmentSplit)
            : truncated;

        long originalLength = buffer.Length;
        byte[] originalBytes = buffer.ToArray();

        var session = new ProbeSession(new ProbeOptions());
        session.ProcessBuffer(ref buffer, Stopwatch.GetTimestamp(), 0, Now);

        buffer.Length.ShouldBe(originalLength);
        buffer.ToArray().ShouldBe(originalBytes);

        ProbeReport report = session.BuildReport(Now, Now, 1, "duration-elapsed", null, "n/a");
        report.EventsReceived.ShouldBe(0UL);
    }

    [Fact]
    public void AFrameSplitAcrossTwoSeparateReadAsyncResultsDecodesOnceTheRestArrives()
    {
        // Two whole frames plus half of a third, exactly what a single ReadAsync might return.
        byte[] two = WireFrame.Concat(WireFrame.Tick(1), WireFrame.Tick(2));
        int half = WireFrame.TickFrameSize / 2;
        byte[] thirdFrame = WireFrame.Tick(3);
        byte[] firstRead = WireFrame.Concat(two, thirdFrame[..half]);

        var session = new ProbeSession(new ProbeOptions());

        var buffer = new ReadOnlySequence<byte>(firstRead);
        session.ProcessBuffer(ref buffer, Stopwatch.GetTimestamp(), 0, Now);

        // The two whole frames were consumed; the half frame is left exactly as it arrived.
        buffer.Length.ShouldBe(half);
        byte[] leftover = buffer.ToArray();
        leftover.ShouldBe(thirdFrame[..half]);

        session.BuildReport(Now, Now, 1, "duration-elapsed", null, "n/a").EventsReceived.ShouldBe(2UL);

        // The next ReadAsync delivers the rest of frame 3. A real PipeReader would hand back the
        // leftover bytes plus the newly arrived ones as one sequence; reproduce that here.
        byte[] secondReadBuffer = WireFrame.Concat(leftover, thirdFrame[half..]);
        var secondBuffer = new ReadOnlySequence<byte>(secondReadBuffer);
        session.ProcessBuffer(ref secondBuffer, Stopwatch.GetTimestamp(), 0, Now);

        secondBuffer.Length.ShouldBe(0);

        ProbeReport finalReport = session.BuildReport(Now, Now, 1, "duration-elapsed", null, "n/a");
        finalReport.EventsReceived.ShouldBe(3UL);
        finalReport.Gaps.ShouldBeEmpty();
        finalReport.IntegrityViolations.ShouldBeEmpty();
    }
}
