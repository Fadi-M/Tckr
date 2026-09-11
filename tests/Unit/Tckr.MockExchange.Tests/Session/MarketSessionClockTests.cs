using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Testing;
using Microsoft.Extensions.Time.Testing;
using Tckr.MockExchange.Options;
using Tckr.MockExchange.Session;

namespace Tckr.MockExchange.Tests.Session;

public class MarketSessionClockTests
{
    /// <summary>A Wednesday, before the default session opens.</summary>
    private static readonly DateTimeOffset BeforeOpen = new(2026, 3, 4, 9, 0, 0, TimeSpan.Zero);

    private static DateTimeOffset At(int hour, int minute) =>
        new(2026, 3, 4, hour, minute, 0, TimeSpan.Zero);

    private static MarketSessionClock NewClock(
        MarketSessionOptions options,
        DateTimeOffset? start = null,
        ILogger<MarketSessionClock>? logger = null) =>
        new(options, new FakeTimeProvider(start ?? BeforeOpen), logger);

    [Fact]
    public void ContinuousModeNeverLeavesContinuousTrading()
    {
        MarketSessionClock session = NewClock(new MarketSessionOptions());
        int transitions = 0;
        session.PhaseChanged += (_, _) => transitions++;

        session.CurrentPhase.ShouldBe(MarketPhase.ContinuousMorning);
        session.CurrentRateMultiplier.ShouldBe(1.0);

        foreach (int hour in new[] { 0, 3, 9, 10, 12, 14, 18, 23 })
        {
            session.Advance(At(hour, 30));
            session.CurrentPhase.ShouldBe(MarketPhase.ContinuousMorning);
            session.CurrentRateMultiplier.ShouldBe(1.0);
            session.EffectiveEventsPerSecond(25_000).ShouldBe(25_000);
        }

        transitions.ShouldBe(0);
    }

    /// <summary>
    /// Walking a whole day a minute at a time must produce exactly one event per boundary, in
    /// order, and nothing in between: a duplicate transition would restart every phase-scoped
    /// counter downstream.
    /// </summary>
    [Fact]
    public void ScheduledModeRaisesExactlyOneEventPerBoundary()
    {
        MarketSessionClock session = NewClock(new MarketSessionOptions { Mode = MarketSessionMode.Scheduled });
        List<(MarketPhase From, MarketPhase To)> transitions = [];
        session.PhaseChanged += (from, to) => transitions.Add((from, to));

        session.CurrentPhase.ShouldBe(MarketPhase.Closed);

        for (DateTimeOffset t = At(0, 0); t < At(23, 59); t += TimeSpan.FromMinutes(1))
        {
            session.Advance(t);
        }

        transitions.ShouldBe(
        [
            (MarketPhase.Closed, MarketPhase.PreOpen),
            (MarketPhase.PreOpen, MarketPhase.OpeningAuction),
            (MarketPhase.OpeningAuction, MarketPhase.ContinuousMorning),
            (MarketPhase.ContinuousMorning, MarketPhase.MiddayLull),
            (MarketPhase.MiddayLull, MarketPhase.ContinuousAfternoon),
            (MarketPhase.ContinuousAfternoon, MarketPhase.ClosingAuction),
            (MarketPhase.ClosingAuction, MarketPhase.Closed),
        ]);
    }

    [Theory]
    [InlineData(9, 29, (int)MarketPhase.Closed, 0.00)]
    [InlineData(9, 30, (int)MarketPhase.PreOpen, 0.10)]
    [InlineData(9, 59, (int)MarketPhase.PreOpen, 0.10)]
    [InlineData(10, 0, (int)MarketPhase.OpeningAuction, 3.00)]
    [InlineData(10, 4, (int)MarketPhase.OpeningAuction, 3.00)]
    [InlineData(10, 5, (int)MarketPhase.ContinuousMorning, 1.20)]
    [InlineData(11, 59, (int)MarketPhase.ContinuousMorning, 1.20)]
    [InlineData(12, 0, (int)MarketPhase.MiddayLull, 0.60)]
    [InlineData(13, 29, (int)MarketPhase.MiddayLull, 0.60)]
    [InlineData(13, 30, (int)MarketPhase.ContinuousAfternoon, 1.00)]
    [InlineData(14, 14, (int)MarketPhase.ContinuousAfternoon, 1.00)]
    [InlineData(14, 15, (int)MarketPhase.ClosingAuction, 2.50)]
    [InlineData(14, 29, (int)MarketPhase.ClosingAuction, 2.50)]
    [InlineData(14, 30, (int)MarketPhase.Closed, 0.00)]
    [InlineData(23, 59, (int)MarketPhase.Closed, 0.00)]
    public void ScheduledModeMapsLocalTimeOfDayToThePhaseSchedule(
        int hour, int minute, int expectedPhase, double expectedMultiplier)
    {
        MarketSessionClock session = NewClock(new MarketSessionOptions { Mode = MarketSessionMode.Scheduled });

        session.Advance(At(hour, minute));

        session.CurrentPhase.ShouldBe((MarketPhase)expectedPhase);
        session.CurrentRateMultiplier.ShouldBe(expectedMultiplier);
        session.EffectiveEventsPerSecond(10_000).ShouldBe(10_000 * expectedMultiplier, 1e-9);
    }

    /// <summary>
    /// The schedule is read in the exchange's own time zone, not the machine's: the same instant
    /// is pre-open in one zone and mid-session in another, and a benchmark that changes shape when
    /// the CI region changes is worthless.
    /// </summary>
    [Fact]
    public void ScheduledModeReadsTheScheduleInTheConfiguredTimeZone()
    {
        MarketSessionOptions options = new()
        {
            Mode = MarketSessionMode.Scheduled,
            TimeZone = "Etc/GMT-2",   // UTC+02:00, fixed offset: no DST to make the test seasonal
        };
        MarketSessionClock session = NewClock(options);

        session.Advance(At(8, 30));    // 10:30 exchange local
        session.CurrentPhase.ShouldBe(MarketPhase.ContinuousMorning);

        session.Advance(At(12, 30));   // 14:30 exchange local
        session.CurrentPhase.ShouldBe(MarketPhase.Closed);
    }

    [Fact]
    public void AnUnknownTimeZoneFallsBackToUtcLoudly()
    {
        FakeLogger<MarketSessionClock> logger = new();
        MarketSessionOptions options = new()
        {
            Mode = MarketSessionMode.Scheduled,
            TimeZone = "Mars/Olympus_Mons",
        };

        MarketSessionClock session = NewClock(options, logger: logger);
        session.Advance(At(10, 30));

        session.CurrentPhase.ShouldBe(MarketPhase.ContinuousMorning);
        logger.Collector.GetSnapshot().ShouldContain(r => r.Level == LogLevel.Warning);
    }

    /// <summary>
    /// A compressed day exists so a demo shows the whole session in five minutes. All seven
    /// phases must appear, in order, inside one window &#8212; including Closed, because the phase
    /// where the tape stops is the one a consumer most needs to have seen before production.
    /// </summary>
    [Fact]
    public void CompressedDayVisitsAllSevenPhasesInOrderWithinTheWindow()
    {
        MarketSessionOptions options = new()
        {
            Mode = MarketSessionMode.CompressedDay,
            CompressedDurationMinutes = 5,
        };
        MarketSessionClock session = NewClock(options);

        List<MarketPhase> observed = [session.CurrentPhase];
        session.PhaseChanged += (_, to) => observed.Add(to);

        TimeSpan window = TimeSpan.FromMinutes(options.CompressedDurationMinutes);
        for (TimeSpan t = TimeSpan.Zero; t < window; t += TimeSpan.FromMilliseconds(100))
        {
            session.Advance(BeforeOpen + t);
        }

        observed.ShouldBe(
        [
            MarketPhase.Closed,
            MarketPhase.PreOpen,
            MarketPhase.OpeningAuction,
            MarketPhase.ContinuousMorning,
            MarketPhase.MiddayLull,
            MarketPhase.ContinuousAfternoon,
            MarketPhase.ClosingAuction,
        ]);
    }

    [Fact]
    public void CompressedDayRepeats()
    {
        MarketSessionOptions options = new()
        {
            Mode = MarketSessionMode.CompressedDay,
            CompressedDurationMinutes = 5,
        };
        MarketSessionClock session = NewClock(options);

        int closedCount = 0;
        session.PhaseChanged += (_, to) =>
        {
            if (to == MarketPhase.Closed)
            {
                closedCount++;
            }
        };

        for (TimeSpan t = TimeSpan.Zero; t < TimeSpan.FromMinutes(10); t += TimeSpan.FromMilliseconds(100))
        {
            session.Advance(BeforeOpen + t);
        }

        closedCount.ShouldBe(1);   // one wrap back to Closed inside two cycles
    }

    /// <summary>
    /// Silently capping is how a benchmark ends up measuring the wrong thing, so the clamp is
    /// logged &#8212; once per phase, because a warning repeated 200 times a second is noise that
    /// hides the next one.
    /// </summary>
    [Fact]
    public void ClampsTheAuctionMultiplierToTheConfiguredCeilingAndLogsItOncePerPhase()
    {
        FakeLogger<MarketSessionClock> logger = new();
        MarketSessionOptions options = new()
        {
            Mode = MarketSessionMode.Scheduled,
            MaxEventsPerSecond = 100_000,
        };
        MarketSessionClock session = NewClock(options, logger: logger);

        session.Advance(At(10, 1));                       // OpeningAuction, x3.0
        session.CurrentRateMultiplier.ShouldBe(3.0);

        for (int i = 0; i < 5; i++)
        {
            session.EffectiveEventsPerSecond(50_000).ShouldBe(100_000);   // 150,000 requested
        }

        logger.Collector.GetSnapshot().Count(r => r.Level == LogLevel.Warning).ShouldBe(1);

        // A new phase is a new clamp: leaving and re-entering the auction warns again.
        session.Advance(At(11, 0));
        session.EffectiveEventsPerSecond(50_000).ShouldBe(60_000);        // 1.2x, under the ceiling
        logger.Collector.GetSnapshot().Count(r => r.Level == LogLevel.Warning).ShouldBe(1);

        session.Advance(At(14, 20));                                      // ClosingAuction, x2.5
        session.EffectiveEventsPerSecond(50_000).ShouldBe(100_000);       // 125,000 requested
        logger.Collector.GetSnapshot().Count(r => r.Level == LogLevel.Warning).ShouldBe(2);
    }

    [Fact]
    public void ClosedSchedulesNothing()
    {
        MarketSessionClock session = NewClock(new MarketSessionOptions { Mode = MarketSessionMode.Scheduled });

        session.Advance(At(3, 0));

        session.CurrentPhase.ShouldBe(MarketPhase.Closed);
        session.EffectiveEventsPerSecond(25_000).ShouldBe(0);
    }

    [Fact]
    public void AJumpWideEnoughToSkipAPhaseReportsOneTransitionToWhereTheSessionActuallyIs()
    {
        MarketSessionClock session = NewClock(new MarketSessionOptions { Mode = MarketSessionMode.Scheduled });
        List<(MarketPhase From, MarketPhase To)> transitions = [];
        session.PhaseChanged += (from, to) => transitions.Add((from, to));

        session.Advance(At(9, 45));    // PreOpen
        session.Advance(At(14, 20));   // straight to ClosingAuction

        transitions.ShouldBe(
        [
            (MarketPhase.Closed, MarketPhase.PreOpen),
            (MarketPhase.PreOpen, MarketPhase.ClosingAuction),
        ]);
    }

    [Fact]
    public void PhaseWindowsAndMultipliersAreConfigurable()
    {
        MarketSessionOptions options = new()
        {
            Mode = MarketSessionMode.Scheduled,
            Phases =
            [
                new() { Phase = MarketPhase.ContinuousMorning, Start = new(1, 0, 0), End = new(2, 0, 0), RateMultiplier = 4.0 },
            ],
        };
        MarketSessionClock session = NewClock(options);

        session.Advance(At(1, 30));
        session.CurrentPhase.ShouldBe(MarketPhase.ContinuousMorning);
        session.EffectiveEventsPerSecond(1_000).ShouldBe(4_000);

        session.Advance(At(2, 30));
        session.CurrentPhase.ShouldBe(MarketPhase.Closed);
    }
}
