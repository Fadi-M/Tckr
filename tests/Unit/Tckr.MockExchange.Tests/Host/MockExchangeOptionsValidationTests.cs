using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Tckr.MockExchange.Options;
using Tckr.MockExchange.Session;

namespace Tckr.MockExchange.Tests.Host;

/// <summary>
/// A bad configuration must stop the process at start-up, with a message that names the setting.
/// </summary>
/// <remarks>
/// The alternative is what the task brief describes: the run starts, behaves subtly differently
/// from what was asked for, and the discrepancy surfaces hours later as an unexplainable benchmark
/// number. Every case here is a configuration that would otherwise have been survivable.
/// </remarks>
public class MockExchangeOptionsValidationTests
{
    [Fact]
    public async Task AnEmptyMessageMixFailsAtStartup()
    {
        Dictionary<string, string?> settings = MockExchangeHostHarness.Defaults();
        settings["MockExchange:Generation:TradeShare"] = "0";
        settings["MockExchange:Generation:BidQuoteShare"] = "0";
        settings["MockExchange:Generation:AskQuoteShare"] = "0";

        (await ShouldFailToStart(settings)).ShouldContain("the message mix is empty");
    }

    [Fact]
    public async Task ANegativeMessageShareFailsAtStartupNamingTheSetting()
    {
        string message = await ShouldFailToStart(MockExchangeHostHarness.BuildWith(
            "MockExchange:Generation:BidQuoteShare", "-0.3"));

        message.ShouldContain("MockExchange:Generation:BidQuoteShare");
    }

    /// <remarks>
    /// The shares are normalised by the generator, so 4/3/3 and 0.4/0.3/0.3 are the same tape and
    /// neither is an error. This pins that: a configuration the task brief would have rejected for
    /// not summing to 1.0 has to start, because rejecting it would make the integer form unusable.
    /// The typo it was protecting against is caught by a start-up warning instead.
    /// </remarks>
    [Fact]
    public async Task IntegerMessageSharesAreLegalBecauseTheMixIsNormalised()
    {
        Dictionary<string, string?> settings = MockExchangeHostHarness.Defaults();
        settings["MockExchange:Generation:TradeShare"] = "4";
        settings["MockExchange:Generation:BidQuoteShare"] = "3";
        settings["MockExchange:Generation:AskQuoteShare"] = "3";

        using IHost host = MockExchangeHostHarness.Build(settings);

        await host.StartAsync(TestTimeout());
        await host.StopAsync(TestTimeout());
    }

    /// <remarks>
    /// This one is not caught by looking at the bound options, and that is the finding worth
    /// recording: <c>ConfigurationBinder</c> binds each item of a collection inside a <c>try</c>
    /// and moves on when it throws, so an entry naming a phase that does not exist is discarded
    /// rather than reported. The exchange would run a schedule silently missing a window — most
    /// likely the one being edited when the typo was made. The validator reads the raw
    /// configuration for exactly this.
    /// </remarks>
    [Fact]
    public async Task AnUnknownPhaseNameFailsAtStartupEvenThoughTheBinderDiscardsItSilently()
    {
        Dictionary<string, string?> settings = MockExchangeHostHarness.Defaults();
        AddPhase(settings, 0, "LunchtimeCross", "09:30", "10:00", 1.0);

        string message = await ShouldFailToStart(settings);

        message.ShouldContain("LunchtimeCross");
        message.ShouldContain("is not a known market phase");
    }

    [Fact]
    public async Task APhaseWindowWithAnUnparseableTimeFailsAtStartup()
    {
        Dictionary<string, string?> settings = MockExchangeHostHarness.Defaults();
        AddPhase(settings, 0, "PreOpen", "half past nine", "10:00", 1.0);

        (await ShouldFailToStart(settings)).ShouldContain("discarded silently");
    }

    /// <remarks>
    /// The binder appends to a collection it finds populated instead of replacing it, and
    /// <see cref="MarketSessionOptions.Phases"/> ships with a full six-phase default. Without the
    /// wiring that empties it first, a configured schedule binds on top of the default one and
    /// every window overlaps its own duplicate — so an ordinary appsettings.json would refuse to
    /// start. This pins the fix.
    /// </remarks>
    [Fact]
    public async Task AConfiguredScheduleReplacesTheDefaultRatherThanAppendingToIt()
    {
        Dictionary<string, string?> settings = MockExchangeHostHarness.Defaults();
        settings["MockExchange:Session:Mode"] = "Scheduled";
        AddPhase(settings, 0, "OpeningAuction", "10:00", "10:05", 3.0);
        AddPhase(settings, 1, "ContinuousMorning", "10:05", "12:00", 1.0);

        using IHost host = MockExchangeHostHarness.Build(settings);
        await host.StartAsync(TestTimeout());

        MarketSessionOptions session = host.Services
            .GetRequiredService<IOptions<MockExchangeOptions>>().Value.Session;

        session.Phases.Count.ShouldBe(2);
        session.Phases.Select(p => p.Phase)
            .ShouldBe([MarketPhase.OpeningAuction, MarketPhase.ContinuousMorning]);

        await host.StopAsync(TestTimeout());
    }

    [Fact]
    public async Task OverlappingPhaseWindowsFailAtStartup()
    {
        Dictionary<string, string?> settings = MockExchangeHostHarness.Defaults();
        AddPhase(settings, 0, "PreOpen", "09:30", "10:30", 0.1);
        AddPhase(settings, 1, "OpeningAuction", "10:00", "10:05", 3.0);

        string message = await ShouldFailToStart(settings);

        message.ShouldContain("must not overlap");
        message.ShouldContain("OpeningAuction");
    }

    [Fact]
    public async Task APhaseWindowThatEndsBeforeItStartsFailsAtStartup()
    {
        Dictionary<string, string?> settings = MockExchangeHostHarness.Defaults();
        AddPhase(settings, 0, "MiddayLull", "13:30", "12:00", 0.6);

        (await ShouldFailToStart(settings)).ShouldContain("must be after Start");
    }

    [Fact]
    public async Task ARateCeilingBelowTheBaseRateFailsAtStartup()
    {
        Dictionary<string, string?> settings = MockExchangeHostHarness.Defaults();
        settings["MockExchange:Session:BaseEventsPerSecond"] = "25000";
        settings["MockExchange:Session:MaxEventsPerSecond"] = "10000";

        string message = await ShouldFailToStart(settings);

        message.ShouldContain("MockExchange:Session:MaxEventsPerSecond");
        message.ShouldContain("BaseEventsPerSecond");
    }

    [Fact]
    public async Task AnUnresolvableTimeZoneFailsAtStartup()
    {
        string message = await ShouldFailToStart(MockExchangeHostHarness.BuildWith(
            "MockExchange:Session:TimeZone", "Mars/Olympus_Mons"));

        message.ShouldContain("MockExchange:Session:TimeZone");
        message.ShouldContain("does not resolve");
    }

    [Fact]
    public async Task AReportIntervalBelowOneSecondFailsAtStartup()
    {
        string message = await ShouldFailToStart(MockExchangeHostHarness.BuildWith(
            "MockExchange:Diagnostics:ThroughputReportIntervalSeconds", "0"));

        message.ShouldContain("MockExchange:Diagnostics:ThroughputReportIntervalSeconds");
    }

    [Fact]
    public async Task AnOutOfRangeGenerationSettingFailsAtStartupNamingTheSetting()
    {
        string message = await ShouldFailToStart(MockExchangeHostHarness.BuildWith(
            "MockExchange:Generation:MeanReversionStrength", "1.5"));

        message.ShouldContain("MockExchange:Generation:MeanReversionStrength");
    }

    /// <remarks>
    /// The single setting whose bound is expressible only as a relationship. It is also the case
    /// that would otherwise surface as an <c>ArgumentOutOfRangeException</c> from the generator's
    /// constructor naming <c>MaxSpreadTicks</c> alone, which sends the reader to the wrong line.
    /// </remarks>
    [Fact]
    public async Task ASpreadWhoseMaximumIsBelowItsMinimumFailsAtStartupNamingBoth()
    {
        Dictionary<string, string?> settings = MockExchangeHostHarness.Defaults();
        settings["MockExchange:Generation:MinSpreadTicks"] = "6";
        settings["MockExchange:Generation:MaxSpreadTicks"] = "2";

        string message = await ShouldFailToStart(settings);

        message.ShouldContain("MaxSpreadTicks");
        message.ShouldContain("MinSpreadTicks");
    }

    [Fact]
    public async Task AListenAddressThatIsNotAnIpAddressFailsAtStartup()
    {
        // Not a validator rule: FeedServer's constructor already rejects it, and duplicating the
        // check would give two sources of truth. What matters is that it still fails at start-up
        // rather than at the first connection, which it does because the publisher service takes
        // the server and hosted services are constructed as the host starts.
        Exception failure = await Should.ThrowAsync<Exception>(async () =>
        {
            using IHost host = MockExchangeHostHarness.BuildWith("MockExchange:Feed:ListenAddress", "localhost");
            await host.StartAsync(TestTimeout());
        });

        Flatten(failure).ShouldContain("is not an IP address");
    }

    private static void AddPhase(
        IDictionary<string, string?> settings, int index, string phase, string start, string end, double multiplier)
    {
        settings[$"MockExchange:Session:Phases:{index}:Phase"] = phase;
        settings[$"MockExchange:Session:Phases:{index}:Start"] = start;
        settings[$"MockExchange:Session:Phases:{index}:End"] = end;
        settings[$"MockExchange:Session:Phases:{index}:RateMultiplier"] = multiplier.ToString("F2");
    }

    private static Task<string> ShouldFailToStart(IDictionary<string, string?> settings) =>
        ShouldFailToStart(MockExchangeHostHarness.Build(settings));

    private static async Task<string> ShouldFailToStart(IHost host)
    {
        using (host)
        {
            OptionsValidationException failure = await Should.ThrowAsync<OptionsValidationException>(
                async () => await host.StartAsync(TestTimeout()));

            return string.Join(Environment.NewLine, failure.Failures);
        }
    }

    private static string Flatten(Exception exception)
    {
        System.Text.StringBuilder builder = new();

        for (Exception? current = exception; current is not null; current = current.InnerException)
        {
            builder.AppendLine(current.Message);
        }

        return builder.ToString();
    }

    private static CancellationToken TestTimeout() => new CancellationTokenSource(TimeSpan.FromSeconds(10)).Token;
}
