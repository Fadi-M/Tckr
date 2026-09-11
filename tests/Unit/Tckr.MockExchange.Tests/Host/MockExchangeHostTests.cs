using System.Diagnostics;
using System.Net;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Tckr.MockExchange.Diagnostics;
using Tckr.MockExchange.Options;
using Tckr.MockExchange.Protocol;
using Tckr.MockExchange.Tests.Feed;

namespace Tckr.MockExchange.Tests.Host;

/// <summary>
/// The assembled process: it starts, it serves a real consumer over a real socket, it stops, and
/// it does not allocate its way through a run.
/// </summary>
/// <remarks>
/// Every test here drives <c>Program.cs</c>'s own registration call. The components already have
/// unit tests of their own; what is unproven until this file runs is that the process composes
/// them into something that produces a decodable, gap-free feed.
/// </remarks>
public class MockExchangeHostTests
{
    private static readonly TimeSpan StartStopBudget = TimeSpan.FromSeconds(5);

    [Fact]
    public async Task TheHostStartsAndStopsWithinTheBudget()
    {
        using IHost host = MockExchangeHostHarness.Build(MockExchangeHostHarness.Defaults());

        long started = Stopwatch.GetTimestamp();
        await host.StartAsync(Timeout());
        Stopwatch.GetElapsedTime(started).ShouldBeLessThan(StartStopBudget);

        long stopping = Stopwatch.GetTimestamp();
        await host.StopAsync(Timeout());
        Stopwatch.GetElapsedTime(stopping).ShouldBeLessThan(StartStopBudget);
    }

    [Fact]
    public async Task TheListenerIsBoundBeforeTheHostFinishesStarting()
    {
        using IHost host = MockExchangeHostHarness.Build(MockExchangeHostHarness.Defaults());

        await host.StartAsync(Timeout());

        // Not "a port was configured" — the bound one. With Port 0 they are different, and the
        // bound one is the only one a consumer can reach.
        IPEndPoint endPoint = MockExchangeHostHarness.EndPointOf(host);
        endPoint.Port.ShouldBeGreaterThan(0);
        endPoint.Address.ShouldBe(IPAddress.Loopback);

        await host.StopAsync(Timeout());
    }

    /// <remarks>
    /// Task 09 sweeps the rate without editing a file, so this is a contract rather than a
    /// convenience. It falls out of the default configuration providers, which is exactly why it
    /// is worth pinning: nothing in this repository would fail if it stopped working.
    /// </remarks>
    [Fact]
    public async Task AnEnvironmentVariableOverridesTheBoundOptions()
    {
        const string variable = "MockExchange__Session__BaseEventsPerSecond";
        string? original = Environment.GetEnvironmentVariable(variable);

        try
        {
            Environment.SetEnvironmentVariable(variable, "4321");

            using IHost host = MockExchangeHostHarness.Build(
                MockExchangeHostHarness.Defaults(),
                configuration => configuration.AddEnvironmentVariables());

            await host.StartAsync(Timeout());

            host.Services.GetRequiredService<IOptions<MockExchangeOptions>>()
                .Value.Session.BaseEventsPerSecond.ShouldBe(4321);

            await host.StopAsync(Timeout());
        }
        finally
        {
            Environment.SetEnvironmentVariable(variable, original);
        }
    }

    /// <remarks>
    /// The end-to-end case the task brief names: a real socket, the real frame reader, and a
    /// thousand records checked for continuity. A gap here is exchange-side loss by construction —
    /// TCP either delivers the byte stream in order or breaks the connection.
    /// </remarks>
    [Fact]
    public async Task AConsumerDecodesAThousandFramesWithNoSequenceGaps()
    {
        Dictionary<string, string?> settings = MockExchangeHostHarness.Defaults();
        settings["MockExchange:Session:BaseEventsPerSecond"] = "5000";

        using IHost host = MockExchangeHostHarness.Build(settings);
        await host.StartAsync(Timeout());

        try
        {
            using FeedTestClient client = await ConnectAsync(host);

            List<FeedRecord> ticks = await ReadTicksAsync(client, 1_000, TimeSpan.FromSeconds(15));

            ticks.Count.ShouldBe(1_000);

            for (int i = 0; i < ticks.Count; i++)
            {
                // Per session, starting at 1, counting records offered.
                ticks[i].SequenceNumber.ShouldBe((ulong)(i + 1));
            }

            ticks.ShouldAllBe(t => t.PriceScaled > 0);
            ticks.ShouldAllBe(t => t.Quantity > 0);
            ticks.Select(t => t.Symbol).Distinct().Count().ShouldBeGreaterThan(1);
        }
        finally
        {
            await host.StopAsync(Timeout());
        }
    }

    /// <remarks>
    /// The tape is a mix, not a stream of trades, and a consumer that only ever sees one message
    /// type is a consumer whose normalisation layer has never been exercised.
    /// </remarks>
    [Fact]
    public async Task TheTapeCarriesTradesAndBothSidesOfTheBook()
    {
        Dictionary<string, string?> settings = MockExchangeHostHarness.Defaults();
        settings["MockExchange:Session:BaseEventsPerSecond"] = "5000";

        using IHost host = MockExchangeHostHarness.Build(settings);
        await host.StartAsync(Timeout());

        try
        {
            using FeedTestClient client = await ConnectAsync(host);
            List<FeedRecord> ticks = await ReadTicksAsync(client, 1_000, TimeSpan.FromSeconds(15));

            ticks.Select(t => t.MessageType).Distinct().OrderBy(t => t).ShouldBe(
                [FeedMessageType.Trade, FeedMessageType.BidQuote, FeedMessageType.AskQuote]);

            // Continuous mode is never an auction, so nothing on the wire should claim to be one.
            ticks.ShouldAllBe(t => !t.IsAuctionPrint);
        }
        finally
        {
            await host.StopAsync(Timeout());
        }
    }

    [Fact]
    public async Task TheMetricsSeeTheSameRunTheConsumerDoes()
    {
        Dictionary<string, string?> settings = MockExchangeHostHarness.Defaults();
        settings["MockExchange:Session:BaseEventsPerSecond"] = "5000";

        using IHost host = MockExchangeHostHarness.Build(settings);
        await host.StartAsync(Timeout());

        try
        {
            FeedMetrics metrics = host.Services.GetRequiredService<FeedMetrics>();

            using FeedTestClient client = await ConnectAsync(host);
            await ReadTicksAsync(client, 500, TimeSpan.FromSeconds(15));

            // BindSessionCount is a late bind the publisher service makes in its constructor;
            // without it this gauge answers from the accept/close ledger instead of the roster.
            metrics.ActiveSessions.ShouldBe(1);

            metrics.GeneratedTotal.ShouldBeGreaterThanOrEqualTo(500);
            metrics.PublishedTotal.ShouldBeGreaterThanOrEqualTo(500);
            metrics.TargetEventsPerSecond.ShouldBe(5000, tolerance: 1);

            // A consumer that kept up must not have been charged for loss.
            metrics.DroppedTotal.ShouldBe(0);
            metrics.SlowDisconnectedTotal.ShouldBe(0);
        }
        finally
        {
            await host.StopAsync(Timeout());
        }
    }

    /// <summary>
    /// Upper bound on steady-state process-wide allocation, in bytes/event, used by both
    /// allocation tests below.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The loop is not literally 0 bytes/event end to end, even though the generator and the frame
    /// encoder individually are (see <c>RandomWalkGeneratorBenchmarkTests</c> and
    /// <c>FeedFrameWriterTests.EncodingIsAllocationFree</c>, which measure those two in isolation
    /// and find exactly zero). <see cref="Tckr.MockExchange.Session.RateGovernor"/> paces each
    /// 5 ms batch by awaiting <c>Task.Delay</c> for the coarse part of the wait before spinning the
    /// last ~2 ms, and that <c>Task.Delay</c> call — async state machine, task, and the
    /// timer/cancellation-registration underneath it — allocates once per batch rather than once
    /// per event. At 25,000 events/sec with a 5 ms batch (125 events/batch, 200 batches/sec) that
    /// floor was measured at <b>19.4-20.5 bytes/event</b> (mean ~19.9) across 35 consecutive
    /// Release runs of <see cref="ASteadyStateRunDoesNotAllocatePerEvent"/> on development
    /// hardware, and at <b>14.4-14.8 bytes/event</b> across 8 runs of the logging-active variant
    /// below — i.e. no higher with the reporter firing than without it, which is the evidence that
    /// this cost is the governor's pacing, not <see cref="ThroughputReporter"/>.
    /// </para>
    /// <para>
    /// The bound is set at roughly double the higher of those two measured maxima: tight enough
    /// that a regression reintroducing genuine per-event allocation on the generate/encode/publish
    /// path — even a modest one, a single small boxed object per record — pushes the number well
    /// past it, with real margin over the governor's own pacing cost so the test does not flake on
    /// ordinary scheduling jitter.
    /// </para>
    /// </remarks>
    private const double MaxBytesPerEvent = 40.0;

    /// <remarks>
    /// <para>
    /// The property under test is that steady-state generation, encoding and batch publishing do
    /// not allocate per event. Unlike the total-bytes-over-a-fixed-window bound this replaces, the
    /// assertion is in bytes/event, so it does not silently loosen or tighten if the window length
    /// or the target rate changes: reallocating the batch buffer per batch, for example, would add
    /// tens of thousands of bytes/event here regardless of how long the test runs.
    /// </para>
    /// <para>
    /// <see cref="MockExchangeHostHarness.Defaults"/> already sets the reporter's interval to
    /// 3600 s and the ambient log level to Warning, so <see cref="ThroughputReporter"/> cannot fire
    /// in this window and its Information-level status line never reaches <c>IsEnabled</c> even if
    /// it did &#8212; this measurement isolates the generation loop from it. See
    /// <see cref="ASteadyStateRunWithActiveStatusLoggingDoesNotAllocatePerEvent"/> for the
    /// counterpart that leaves the reporter running.
    /// </para>
    /// <para>
    /// Measured process-wide, because the loop runs on its own thread and a per-thread counter
    /// would miss whatever the publish path allocated on another. The DoD also claims no Gen2
    /// collections over a run; at these allocation volumes a 2-second window would not trigger one
    /// even under a broken hot path, so that half of the claim is checked directly rather than
    /// inferred from the byte count.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task ASteadyStateRunDoesNotAllocatePerEvent()
    {
        Dictionary<string, string?> settings = MockExchangeHostHarness.Defaults();
        settings["MockExchange:Session:BaseEventsPerSecond"] = "25000";

        using IHost host = MockExchangeHostHarness.Build(settings);
        await host.StartAsync(Timeout());

        try
        {
            FeedMetrics metrics = host.Services.GetRequiredService<FeedMetrics>();

            // Let the loop reach steady state before measuring: JIT, the first timer, and the
            // symbol universe's own warm-up all land in the first fraction of a second.
            await Task.Delay(TimeSpan.FromSeconds(1));

            long generatedBefore = metrics.GeneratedTotal;
            long allocatedBefore = GC.GetTotalAllocatedBytes(precise: true);
            int gen2CollectionsBefore = GC.CollectionCount(2);

            await Task.Delay(TimeSpan.FromSeconds(2));

            long allocated = GC.GetTotalAllocatedBytes(precise: true) - allocatedBefore;
            long generated = metrics.GeneratedTotal - generatedBefore;
            int gen2Collections = GC.CollectionCount(2) - gen2CollectionsBefore;

            generated.ShouldBeGreaterThan(25_000);

            double bytesPerEvent = (double)allocated / generated;
            bytesPerEvent.ShouldBeLessThan(
                MaxBytesPerEvent,
                $"Allocated {allocated:N0} bytes over {generated:N0} events ({bytesPerEvent:F2} bytes/event). "
                + "Measured baseline for this configuration is ~19.4-20.5 bytes/event, attributable to "
                + "RateGovernor's per-batch Task.Delay pacing rather than to per-event generation, "
                + "encoding or publishing. A materially higher number means something on the hot path "
                + "started allocating per event.");

            gen2Collections.ShouldBe(
                0, $"{gen2Collections} Gen2 collection(s) occurred while generating {generated:N0} events.");
        }
        finally
        {
            await host.StopAsync(Timeout());
        }
    }

    /// <remarks>
    /// The end-to-end counterpart to <see cref="ASteadyStateRunDoesNotAllocatePerEvent"/>: this one
    /// does not suppress <see cref="ThroughputReporter"/>. It sets the reporter's interval to one
    /// second and raises the ambient log level to Information so the status line actually formats
    /// and logs inside the measured window, rather than being configured away as in the test above.
    /// Any allocation the periodic logging itself introduces is therefore inside this number.
    /// Measured at ~14.4-14.8 bytes/event across 8 Release runs &#8212; no higher than the
    /// reporter-suppressed test, which is why both tests share <see cref="MaxBytesPerEvent"/>
    /// rather than this one carrying a separately loosened bound.
    /// </remarks>
    [Fact]
    public async Task ASteadyStateRunWithActiveStatusLoggingDoesNotAllocatePerEvent()
    {
        Dictionary<string, string?> settings = MockExchangeHostHarness.Defaults();
        settings["MockExchange:Session:BaseEventsPerSecond"] = "25000";
        settings["MockExchange:Diagnostics:ThroughputReportIntervalSeconds"] = "1";

        using IHost host = MockExchangeHostHarness.Build(settings, minimumLevel: LogLevel.Information);
        await host.StartAsync(Timeout());

        try
        {
            FeedMetrics metrics = host.Services.GetRequiredService<FeedMetrics>();

            // Long enough that, at a 1-second reporter interval, at least two status lines land
            // inside the measured window rather than only the warm-up second.
            await Task.Delay(TimeSpan.FromSeconds(1));

            long generatedBefore = metrics.GeneratedTotal;
            long allocatedBefore = GC.GetTotalAllocatedBytes(precise: true);

            await Task.Delay(TimeSpan.FromSeconds(3));

            long allocated = GC.GetTotalAllocatedBytes(precise: true) - allocatedBefore;
            long generated = metrics.GeneratedTotal - generatedBefore;

            generated.ShouldBeGreaterThan(25_000);

            double bytesPerEvent = (double)allocated / generated;
            bytesPerEvent.ShouldBeLessThan(
                MaxBytesPerEvent,
                $"Allocated {allocated:N0} bytes over {generated:N0} events ({bytesPerEvent:F2} bytes/event) "
                + "with the throughput reporter actively logging once a second at Information level.");
        }
        finally
        {
            await host.StopAsync(Timeout());
        }
    }

    /// <remarks>
    /// The exchange's central promise. Nothing in the loop awaits a consumer, so the tape has to
    /// keep moving with nobody attached — and the case that would break it silently is the one
    /// where a consumer connects, then leaves.
    /// </remarks>
    [Fact]
    public async Task GenerationContinuesWithNoConsumerAttached()
    {
        Dictionary<string, string?> settings = MockExchangeHostHarness.Defaults();
        settings["MockExchange:Session:BaseEventsPerSecond"] = "5000";

        using IHost host = MockExchangeHostHarness.Build(settings);
        await host.StartAsync(Timeout());

        try
        {
            FeedMetrics metrics = host.Services.GetRequiredService<FeedMetrics>();

            using (FeedTestClient client = await ConnectAsync(host))
            {
                await ReadTicksAsync(client, 100, TimeSpan.FromSeconds(15));
            }

            await FeedTestHarness.WaitForAsync(
                () => metrics.ActiveSessions == 0, TimeSpan.FromSeconds(5), "the session to close");

            long afterDisconnect = metrics.GeneratedTotal;
            await Task.Delay(TimeSpan.FromMilliseconds(500));

            metrics.GeneratedTotal.ShouldBeGreaterThan(
                afterDisconnect,
                "Generation must not stop when the last consumer leaves.");
        }
        finally
        {
            await host.StopAsync(Timeout());
        }
    }

    private static async Task<FeedTestClient> ConnectAsync(IHost host)
    {
        FeedTestClient client = await FeedTestClient.ConnectAsync(MockExchangeHostHarness.EndPointOf(host), 64 * 1024);

        DecodedFrame frame = await client.ReadFrameAsync(TimeSpan.FromSeconds(5));
        frame.Type.ShouldBe(FeedMessageType.SessionStart);

        FeedFrameReader.ReadSessionStart(frame.Payload, out Guid sessionId, out uint heartbeatMs, out long startNanos);
        client.SessionId = sessionId;
        client.HeartbeatIntervalMs = heartbeatMs;
        client.SessionStartNanos = startNanos;

        return client;
    }

    /// <summary>Reads ticks of any type, skipping the heartbeats that do not consume a sequence number.</summary>
    private static async Task<List<FeedRecord>> ReadTicksAsync(FeedTestClient client, int count, TimeSpan timeout)
    {
        List<FeedRecord> ticks = new(count);

        while (ticks.Count < count)
        {
            DecodedFrame frame = await client.ReadFrameAsync(timeout);

            if (frame.Type == FeedMessageType.Heartbeat)
            {
                continue;
            }

            frame.Type.ShouldBeOneOf(FeedMessageType.Trade, FeedMessageType.BidQuote, FeedMessageType.AskQuote);
            ticks.Add(FeedFrameReader.ReadTick(frame.Payload));
        }

        return ticks;
    }

    private static CancellationToken Timeout() =>
        new CancellationTokenSource(TimeSpan.FromSeconds(20)).Token;
}
