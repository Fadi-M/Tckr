using Microsoft.Extensions.Time.Testing;
using Tckr.MockExchange.Diagnostics;

namespace Tckr.MockExchange.Tests.Diagnostics;

/// <summary>
/// The rolling achieved-rate window, driven entirely by a virtual clock.
/// </summary>
/// <remarks>
/// These tests are the reason the window takes a <see cref="TimeProvider"/> at all: a stall in the
/// middle of a five-second window is a five-second test against the wall clock and a
/// sub-millisecond one against a fake, and the assertions are exact rather than approximate
/// because nothing is racing.
/// </remarks>
public class RollingRateWindowTests
{
    private static readonly DateTimeOffset Origin = new(2026, 3, 4, 9, 30, 0, TimeSpan.Zero);
    private static readonly TimeSpan Batch = TimeSpan.FromMilliseconds(5);

    /// <summary>Emits <paramref name="eventsPerSecond"/> in 5 ms batches for <paramref name="duration"/>.</summary>
    private static void Emit(RollingRateWindow window, FakeTimeProvider clock, double eventsPerSecond, TimeSpan duration)
    {
        int batches = (int)(duration / Batch);
        long perBatch = (long)(eventsPerSecond * Batch.TotalSeconds);

        for (int i = 0; i < batches; i++)
        {
            window.Add(perBatch);
            clock.Advance(Batch);
        }
    }

    [Fact]
    public void ReportsTheRateItWasFed()
    {
        FakeTimeProvider clock = new(Origin);
        RollingRateWindow window = new(clock);

        Emit(window, clock, 25_000, TimeSpan.FromSeconds(5));

        window.EventsPerSecond().ShouldBe(25_000, 250);
    }

    /// <summary>
    /// The failure this component exists for. A cumulative average of these two halves reports
    /// ~13,000/sec and looks merely disappointing; the window reports the collapse.
    /// </summary>
    [Fact]
    public void AMidWindowStallIsNotAveragedAway()
    {
        FakeTimeProvider clock = new(Origin);
        RollingRateWindow window = new(clock);

        Emit(window, clock, 25_000, TimeSpan.FromSeconds(2.5));
        double beforeStall = window.EventsPerSecond();

        // Nothing generated for the second half of the window.
        clock.Advance(TimeSpan.FromSeconds(2.5));

        beforeStall.ShouldBe(25_000, 250);
        window.EventsPerSecond().ShouldBe(12_500, 250);
    }

    [Fact]
    public void DecaysToZeroOnceTheStallOutlastsTheWindow()
    {
        FakeTimeProvider clock = new(Origin);
        RollingRateWindow window = new(clock);

        Emit(window, clock, 25_000, TimeSpan.FromSeconds(5));
        clock.Advance(TimeSpan.FromSeconds(6));

        window.EventsPerSecond().ShouldBe(0);
    }

    /// <summary>
    /// A silence longer than the ring must clear every slot, not lap it. Without the wide-gap
    /// branch in <c>AdvanceTo</c> this returns the rate from a minute ago.
    /// </summary>
    [Fact]
    public void ASilenceLongerThanTheRingDoesNotResurrectOldCounts()
    {
        FakeTimeProvider clock = new(Origin);
        RollingRateWindow window = new(clock);

        Emit(window, clock, 25_000, TimeSpan.FromSeconds(5));
        clock.Advance(TimeSpan.FromMinutes(1));

        window.EventsPerSecond().ShouldBe(0);
    }

    [Fact]
    public void ReportsZeroBeforeTheFirstBucketCompletes()
    {
        FakeTimeProvider clock = new(Origin);
        RollingRateWindow window = new(clock);

        window.Add(1_000);

        window.EventsPerSecond().ShouldBe(0);
    }

    /// <summary>
    /// A partly elapsed window divides by what has actually elapsed. Dividing by the full window
    /// would report a third of the true rate for the first few seconds of every run, which reads
    /// as a slow start that never happened.
    /// </summary>
    [Fact]
    public void UsesOnlyTheElapsedPartOfAWindowThatIsNotYetFull()
    {
        FakeTimeProvider clock = new(Origin);
        RollingRateWindow window = new(clock);

        Emit(window, clock, 25_000, TimeSpan.FromSeconds(1.5));

        window.EventsPerSecond().ShouldBe(25_000, 250);
    }

    /// <summary>
    /// The bucket being filled is deliberately excluded, so a rate read part-way through one is
    /// not dragged down by the fraction of it that has happened.
    /// </summary>
    [Fact]
    public void ThePartialBucketDoesNotDepressTheRate()
    {
        FakeTimeProvider clock = new(Origin);
        RollingRateWindow window = new(clock);

        Emit(window, clock, 25_000, TimeSpan.FromSeconds(5));

        // A tenth of a bucket into the next one.
        clock.Advance(TimeSpan.FromMilliseconds(50));
        window.Add(1_250);

        window.EventsPerSecond().ShouldBe(25_000, 250);
    }

    [Fact]
    public void RejectsANonPositiveWindow()
    {
        FakeTimeProvider clock = new(Origin);

        Should.Throw<ArgumentOutOfRangeException>(() => new RollingRateWindow(clock, TimeSpan.Zero));
        Should.Throw<ArgumentOutOfRangeException>(() => new RollingRateWindow(clock, TimeSpan.FromSeconds(1), 0));
    }
}
