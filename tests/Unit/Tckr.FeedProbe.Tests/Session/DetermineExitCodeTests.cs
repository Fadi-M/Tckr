namespace Tckr.FeedProbe.Tests.Session;

/// <summary>
/// <see cref="ProbeSession.DetermineExitCode"/>: the priority order (3 beats 1 beats 2), the
/// <c>--expect-drops</c> gate on gap-only failures, and the &#177;2% rate-tolerance boundary.
/// </summary>
public class DetermineExitCodeTests
{
    private const double Target = 10_000;

    // ---- the clean-pass baseline -----------------------------------------------------------

    [Fact]
    public void NoProblemsAtTargetRatePasses()
    {
        int code = ProbeSession.DetermineExitCode(
            sessionEstablished: true, framingErrorCount: 0, integrityViolationCount: 0, gapCount: 0,
            expectDrops: false, achievedRate: Target, targetRate: Target);

        code.ShouldBe(0);
    }

    // ---- priority: 3 beats everything -------------------------------------------------------

    [Fact]
    public void NoSessionAlwaysWinsEvenWithNoOtherProblems()
    {
        int code = ProbeSession.DetermineExitCode(
            sessionEstablished: false, framingErrorCount: 0, integrityViolationCount: 0, gapCount: 0,
            expectDrops: false, achievedRate: Target, targetRate: Target);

        code.ShouldBe(3);
    }

    [Fact]
    public void NoSessionBeatsFramingErrorsAndBadRate()
    {
        int code = ProbeSession.DetermineExitCode(
            sessionEstablished: false, framingErrorCount: 5, integrityViolationCount: 3, gapCount: 2,
            expectDrops: false, achievedRate: 1, targetRate: Target);

        code.ShouldBe(3);
    }

    // ---- priority: 1 beats 2 ------------------------------------------------------------------

    [Fact]
    public void FramingErrorsBeatABadRate()
    {
        int code = ProbeSession.DetermineExitCode(
            sessionEstablished: true, framingErrorCount: 1, integrityViolationCount: 0, gapCount: 0,
            expectDrops: false, achievedRate: 1, targetRate: Target);

        code.ShouldBe(1);
    }

    [Fact]
    public void IntegrityViolationsBeatABadRate()
    {
        int code = ProbeSession.DetermineExitCode(
            sessionEstablished: true, framingErrorCount: 0, integrityViolationCount: 1, gapCount: 0,
            expectDrops: true, achievedRate: 1, targetRate: Target);

        code.ShouldBe(1);
    }

    [Fact]
    public void AnUnexpectedGapBeatsABadRate()
    {
        int code = ProbeSession.DetermineExitCode(
            sessionEstablished: true, framingErrorCount: 0, integrityViolationCount: 0, gapCount: 1,
            expectDrops: false, achievedRate: 1, targetRate: Target);

        code.ShouldBe(1);
    }

    // ---- the --expect-drops gate --------------------------------------------------------------

    [Fact]
    public void AGapWithoutExpectDropsFails()
    {
        int code = ProbeSession.DetermineExitCode(
            sessionEstablished: true, framingErrorCount: 0, integrityViolationCount: 0, gapCount: 3,
            expectDrops: false, achievedRate: Target, targetRate: Target);

        code.ShouldBe(1);
    }

    [Fact]
    public void AGapWithExpectDropsDoesNotFailByItself()
    {
        int code = ProbeSession.DetermineExitCode(
            sessionEstablished: true, framingErrorCount: 0, integrityViolationCount: 0, gapCount: 3,
            expectDrops: true, achievedRate: Target, targetRate: Target);

        code.ShouldBe(0);
    }

    [Fact]
    public void ExpectDropsDoesNotSuppressAReorderOrDuplicate()
    {
        // A gap is admitted loss; an integrity violation (reorder/duplicate) is never legitimate
        // under either slow-consumer policy, so --expect-drops must not gate it.
        int code = ProbeSession.DetermineExitCode(
            sessionEstablished: true, framingErrorCount: 0, integrityViolationCount: 1, gapCount: 0,
            expectDrops: true, achievedRate: Target, targetRate: Target);

        code.ShouldBe(1);
    }

    [Fact]
    public void ExpectDropsDoesNotSuppressAFramingError()
    {
        int code = ProbeSession.DetermineExitCode(
            sessionEstablished: true, framingErrorCount: 1, integrityViolationCount: 0, gapCount: 0,
            expectDrops: true, achievedRate: Target, targetRate: Target);

        code.ShouldBe(1);
    }

    // ---- the ±2% rate-tolerance boundary, both sides -------------------------------------------

    [Theory]
    [InlineData(10_199)]   // +1.99% — just inside
    [InlineData(9_801)]    // -1.99% — just inside
    [InlineData(10_200)]   // +2.00% exactly — the boundary itself still passes ("> 0.02" is strict)
    [InlineData(9_800)]    // -2.00% exactly
    public void RateWithinOrAtTheTwoPercentToleranceBoundaryPasses(double achievedRate)
    {
        int code = ProbeSession.DetermineExitCode(
            sessionEstablished: true, framingErrorCount: 0, integrityViolationCount: 0, gapCount: 0,
            expectDrops: false, achievedRate: achievedRate, targetRate: Target);

        code.ShouldBe(0);
    }

    [Theory]
    [InlineData(10_201)]   // +2.01% — just outside
    [InlineData(9_799)]    // -2.01% — just outside
    public void RateJustOutsideTheTwoPercentToleranceFails(double achievedRate)
    {
        int code = ProbeSession.DetermineExitCode(
            sessionEstablished: true, framingErrorCount: 0, integrityViolationCount: 0, gapCount: 0,
            expectDrops: false, achievedRate: achievedRate, targetRate: Target);

        code.ShouldBe(2);
    }
}
