using System.Buffers;
using System.Diagnostics;
using Tckr.FeedProbe.Tests.Support;

namespace Tckr.FeedProbe.Tests.Session;

/// <summary>
/// The sequence-integrity branch inside <c>ProbeSession.HandleTick</c> (called through the internal
/// <see cref="ProbeSession.ProcessBuffer"/>): a clean increment, a real gap, a reorder and a
/// duplicate must each be classified correctly, and gaps must stay a separate bucket from
/// integrity violations (see <c>Events.cs</c> remarks — a gap is admitted loss, an integrity
/// violation is a protocol invariant violation, and they are never conflated).
/// </summary>
public class SequenceHandlingTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.UtcNow;

    [Fact]
    public void CleanIncrementingSequenceRecordsNoGapsAndNoViolations()
    {
        ProbeSession session = NewSession();
        Feed(session, WireFrame.Tick(1), WireFrame.Tick(2), WireFrame.Tick(3));

        ProbeReport report = Report(session);

        report.EventsReceived.ShouldBe(3UL);
        report.Gaps.ShouldBeEmpty();
        report.IntegrityViolations.ShouldBeEmpty();
    }

    [Fact]
    public void AMissingSequenceNumberIsRecordedAsAGapOfTheExactSize()
    {
        ProbeSession session = NewSession();
        // 1, 2, then 5: three records (3, 4, and the "slot" 5 replaces) were never delivered.
        Feed(session, WireFrame.Tick(1), WireFrame.Tick(2), WireFrame.Tick(5));

        ProbeReport report = Report(session);

        report.EventsReceived.ShouldBe(3UL);
        report.Gaps.Count.ShouldBe(1);
        report.IntegrityViolations.ShouldBeEmpty();

        GapEvent gap = report.Gaps[0];
        gap.ExpectedSequence.ShouldBe(3UL);
        gap.ReceivedSequence.ShouldBe(5UL);
        gap.GapSize.ShouldBe(2UL);
        report.RecordsLost.ShouldBe(2UL);
    }

    [Fact]
    public void AReorderedLowerSequenceNumberIsAnIntegrityViolationNotAGap()
    {
        ProbeSession session = NewSession();
        // 1, 2, 3, then 2 again out of order.
        Feed(session, WireFrame.Tick(1), WireFrame.Tick(2), WireFrame.Tick(3), WireFrame.Tick(2));

        ProbeReport report = Report(session);

        report.EventsReceived.ShouldBe(4UL);
        report.Gaps.ShouldBeEmpty();
        report.IntegrityViolations.Count.ShouldBe(1);

        SequenceIntegrityViolation violation = report.IntegrityViolations[0];
        violation.ExpectedSequence.ShouldBe(4UL);
        violation.ReceivedSequence.ShouldBe(2UL);
    }

    [Fact]
    public void ARepeatedSequenceNumberIsAnIntegrityViolation()
    {
        ProbeSession session = NewSession();
        // 1, 2, then 2 again — an exact duplicate rather than a lower reorder.
        Feed(session, WireFrame.Tick(1), WireFrame.Tick(2), WireFrame.Tick(2));

        ProbeReport report = Report(session);

        report.EventsReceived.ShouldBe(3UL);
        report.Gaps.ShouldBeEmpty();
        report.IntegrityViolations.Count.ShouldBe(1);

        SequenceIntegrityViolation violation = report.IntegrityViolations[0];
        violation.ExpectedSequence.ShouldBe(3UL);
        violation.ReceivedSequence.ShouldBe(2UL);
    }

    [Fact]
    public void GapsAndViolationsAreCountedSeparatelyWithinOneRun()
    {
        ProbeSession session = NewSession();
        // Clean 1,2 ; gap to 5 (loses 3,4) ; clean 6 ; duplicate of 6 ; clean 7.
        Feed(
            session,
            WireFrame.Tick(1), WireFrame.Tick(2), WireFrame.Tick(5), WireFrame.Tick(6),
            WireFrame.Tick(6), WireFrame.Tick(7));

        ProbeReport report = Report(session);

        report.EventsReceived.ShouldBe(6UL);
        report.Gaps.Count.ShouldBe(1);
        report.RecordsLost.ShouldBe(2UL);
        report.IntegrityViolations.Count.ShouldBe(1);
    }

    [Fact]
    public void SequenceStateCarriesAcrossSeparateProcessBufferCallsLikeSeparateReads()
    {
        // Exercises the same state machine as SequenceHandlingTests above, but split across two
        // separate ProcessBuffer invocations, the way two separate PipeReader.ReadAsync results
        // would arrive.
        ProbeSession session = NewSession();

        ReadOnlySequence<byte> first = new(WireFrame.Tick(1));
        session.ProcessBuffer(ref first, Stopwatch.GetTimestamp(), 0, Now);

        ReadOnlySequence<byte> second = new(WireFrame.Tick(3)); // gap: 2 was never sent
        session.ProcessBuffer(ref second, Stopwatch.GetTimestamp(), 0, Now);

        ProbeReport report = Report(session);
        report.EventsReceived.ShouldBe(2UL);
        report.Gaps.Count.ShouldBe(1);
        report.Gaps[0].ExpectedSequence.ShouldBe(2UL);
        report.Gaps[0].ReceivedSequence.ShouldBe(3UL);
        report.Gaps[0].GapSize.ShouldBe(1UL);
    }

    private static ProbeSession NewSession() => new(new ProbeOptions());

    private static void Feed(ProbeSession session, params byte[][] frames)
    {
        byte[] all = WireFrame.Concat(frames);
        var buffer = new ReadOnlySequence<byte>(all);
        session.ProcessBuffer(ref buffer, Stopwatch.GetTimestamp(), 0, Now);
    }

    private static ProbeReport Report(ProbeSession session) =>
        session.BuildReport(Now, Now, activeSeconds: 1, endReason: "duration-elapsed", stallAfterSeconds: null, stallOutcome: "n/a");
}
