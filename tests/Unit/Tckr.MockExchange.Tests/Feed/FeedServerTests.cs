using System.Diagnostics;
using Tckr.MockExchange.Feed;
using Tckr.MockExchange.Options;
using Tckr.MockExchange.Protocol;

namespace Tckr.MockExchange.Tests.Feed;

/// <summary>
/// Session lifecycle, sequence numbering and heartbeats.
/// </summary>
public sealed class FeedServerTests
{
    [Fact]
    public async Task Accept_writes_a_well_formed_session_start_first()
    {
        await using FeedTestHarness harness = await FeedTestHarness.StartAsync();
        using FeedTestClient client = await harness.ConnectAsync();

        client.SessionId.ShouldNotBe(Guid.Empty);
        client.HeartbeatIntervalMs.ShouldBe((uint)harness.Options.HeartbeatIntervalMs);
        client.SessionStartNanos.ShouldBeGreaterThan(0);

        harness.Metrics.Accepted.ShouldBe(1);
        harness.Server.ActiveSessionCount.ShouldBe(1);
    }

    [Fact]
    public async Task Sequence_numbers_start_at_one_and_increase_by_one_per_tick()
    {
        await using FeedTestHarness harness = await FeedTestHarness.StartAsync();
        using FeedTestClient client = await harness.ConnectAsync();

        harness.Server.Publish(FeedTestHarness.MakeBatch(3)).ShouldBe(1);
        harness.Server.Publish(FeedTestHarness.MakeBatch(2)).ShouldBe(1);

        List<FeedRecord> ticks = await client.ReadTicksAsync(5, TimeSpan.FromSeconds(5));

        ticks.Select(t => t.SequenceNumber).ShouldBe([1UL, 2UL, 3UL, 4UL, 5UL]);
    }

    [Fact]
    public async Task Two_concurrent_sessions_number_independently_from_one()
    {
        await using FeedTestHarness harness = await FeedTestHarness.StartAsync();
        using FeedTestClient first = await harness.ConnectAsync();
        using FeedTestClient second = await harness.ConnectAsync();

        harness.Server.Publish(FeedTestHarness.MakeBatch(4)).ShouldBe(2);

        List<FeedRecord> fromFirst = await first.ReadTicksAsync(4, TimeSpan.FromSeconds(5));
        List<FeedRecord> fromSecond = await second.ReadTicksAsync(4, TimeSpan.FromSeconds(5));

        fromFirst.Select(t => t.SequenceNumber).ShouldBe([1UL, 2UL, 3UL, 4UL]);
        fromSecond.Select(t => t.SequenceNumber).ShouldBe([1UL, 2UL, 3UL, 4UL]);
        first.SessionId.ShouldNotBe(second.SessionId);
    }

    [Fact]
    public async Task A_session_joining_mid_stream_starts_at_one()
    {
        await using FeedTestHarness harness = await FeedTestHarness.StartAsync();
        using FeedTestClient early = await harness.ConnectAsync();

        harness.Server.Publish(FeedTestHarness.MakeBatch(10));
        await early.ReadTicksAsync(10, TimeSpan.FromSeconds(5));

        using FeedTestClient late = await harness.ConnectAsync();

        harness.Server.Publish(FeedTestHarness.MakeBatch(5)).ShouldBe(2);

        List<FeedRecord> lateTicks = await late.ReadTicksAsync(5, TimeSpan.FromSeconds(5));
        List<FeedRecord> earlyTicks = await early.ReadTicksAsync(5, TimeSpan.FromSeconds(5));

        lateTicks.Select(t => t.SequenceNumber).ShouldBe([1UL, 2UL, 3UL, 4UL, 5UL]);
        earlyTicks.Select(t => t.SequenceNumber).ShouldBe([11UL, 12UL, 13UL, 14UL, 15UL]);
    }

    [Fact]
    public async Task Publish_with_no_consumers_is_a_no_op_returning_zero()
    {
        await using FeedTestHarness harness = await FeedTestHarness.StartAsync();

        harness.Server.ActiveSessionCount.ShouldBe(0);

        // Generation does not care whether anyone is listening: this must stay free and must not
        // throw, so the publisher loop can run flat out with nobody connected.
        for (int i = 0; i < 1000; i++)
        {
            harness.Server.Publish(FeedTestHarness.MakeBatch(50)).ShouldBe(0);
        }

        harness.Metrics.TotalBytesWritten.ShouldBe(0);
    }

    [Fact]
    public async Task Heartbeat_arrives_within_one_and_a_half_intervals_when_the_rate_is_zero()
    {
        await using FeedTestHarness harness = await FeedTestHarness.StartAsync(o => o.HeartbeatIntervalMs = 200);
        using FeedTestClient client = await harness.ConnectAsync();

        long started = Stopwatch.GetTimestamp();
        DecodedFrame frame = await client.ReadFrameAsync(TimeSpan.FromSeconds(5));
        TimeSpan elapsed = Stopwatch.GetElapsedTime(started);

        frame.Type.ShouldBe(FeedMessageType.Heartbeat);
        elapsed.TotalMilliseconds.ShouldBeLessThan(200 * 1.5);

        FeedFrameReader.ReadHeartbeat(frame.Payload, out ulong lastSequence, out long timestampNanos);
        lastSequence.ShouldBe(0UL);
        timestampNanos.ShouldBeGreaterThan(0);
    }

    [Fact]
    public async Task Heartbeat_reports_the_last_sequence_number_sent()
    {
        await using FeedTestHarness harness = await FeedTestHarness.StartAsync(o => o.HeartbeatIntervalMs = 150);
        using FeedTestClient client = await harness.ConnectAsync();

        harness.Server.Publish(FeedTestHarness.MakeBatch(3));
        await client.ReadTicksAsync(3, TimeSpan.FromSeconds(5));

        DecodedFrame frame = await client.ReadFrameAsync(TimeSpan.FromSeconds(5));

        frame.Type.ShouldBe(FeedMessageType.Heartbeat);
        FeedFrameReader.ReadHeartbeat(frame.Payload, out ulong lastSequence, out _);
        lastSequence.ShouldBe(3UL);
    }

    [Fact]
    public async Task Heartbeats_are_not_sent_while_ticks_are_flowing()
    {
        await using FeedTestHarness harness = await FeedTestHarness.StartAsync(o => o.HeartbeatIntervalMs = 200);
        using FeedTestClient client = await harness.ConnectAsync();

        const int batches = 30;
        const int perBatch = 4;

        Task<List<DecodedFrame>> reader = Task.Run(async () =>
        {
            List<DecodedFrame> frames = [];
            while (frames.Count < batches * perBatch)
            {
                frames.Add(await client.ReadFrameAsync(TimeSpan.FromSeconds(5)));
            }

            return frames;
        });

        // A batch every ~20 ms for well over a heartbeat interval: the session is never idle long
        // enough to owe a heartbeat.
        for (int i = 0; i < batches; i++)
        {
            harness.Server.Publish(FeedTestHarness.MakeBatch(perBatch));
            await Task.Delay(20);
        }

        List<DecodedFrame> received = await reader;

        received.Count.ShouldBe(batches * perBatch);
        received.ShouldAllBe(f => f.Type == FeedMessageType.Trade);
    }

    [Fact]
    public async Task An_abruptly_killed_client_is_removed_cleanly()
    {
        await using FeedTestHarness harness = await FeedTestHarness.StartAsync();
        FeedTestClient client = await harness.ConnectAsync();

        harness.Server.Publish(FeedTestHarness.MakeBatch(5));
        await client.ReadTicksAsync(5, TimeSpan.FromSeconds(5));

        client.Kill();

        // Keep generating: the exchange does not stop because a consumer died, and the write that
        // discovers the dead socket is what removes the session.
        await FeedTestHarness.WaitForAsync(
            () =>
            {
                harness.Server.Publish(FeedTestHarness.MakeBatch(10));
                return harness.Server.ActiveSessionCount == 0;
            },
            TimeSpan.FromSeconds(10),
            "the killed session to be removed");

        harness.Metrics.ClosureSnapshot().Count.ShouldBe(1);
        harness.ErrorLogs.ShouldBeEmpty("a dead client is routine, not an error");

        // And the server still works.
        using FeedTestClient replacement = await harness.ConnectAsync();
        harness.Server.Publish(FeedTestHarness.MakeBatch(2)).ShouldBe(1);

        List<FeedRecord> ticks = await replacement.ReadTicksAsync(2, TimeSpan.FromSeconds(5));
        ticks.Select(t => t.SequenceNumber).ShouldBe([1UL, 2UL]);
    }

    [Fact]
    public async Task Connections_beyond_MaxSessions_are_closed_with_a_logged_reason()
    {
        await using FeedTestHarness harness = await FeedTestHarness.StartAsync(o => o.MaxSessions = 2);

        using FeedTestClient first = await harness.ConnectAsync();
        using FeedTestClient second = await harness.ConnectAsync();

        harness.Server.ActiveSessionCount.ShouldBe(2);

        using FeedTestClient extra = await FeedTestClient.ConnectAsync(harness.EndPoint, 4096);

        // Never left hanging: accepted, then closed at once.
        (await extra.IsClosedAsync(TimeSpan.FromSeconds(5))).ShouldBeTrue();

        await FeedTestHarness.WaitForAsync(
            () => harness.Metrics.RejectionSnapshot().Count == 1,
            TimeSpan.FromSeconds(5),
            "the rejection to be counted");

        harness.Metrics.RejectionSnapshot().ShouldBe(["max-sessions"]);
        harness.HasLoggedReason(reason => reason == "max-sessions")
            .ShouldBeTrue("a refused consumer must be told why in the log");

        harness.Server.ActiveSessionCount.ShouldBe(2);
    }

    [Fact]
    public async Task Graceful_shutdown_closes_every_session_within_the_timeout()
    {
        await using FeedTestHarness harness = await FeedTestHarness.StartAsync(o => o.ShutdownTimeoutMs = 1000);

        using FeedTestClient first = await harness.ConnectAsync();
        using FeedTestClient second = await harness.ConnectAsync();

        harness.Server.Publish(FeedTestHarness.MakeBatch(20)).ShouldBe(2);

        long started = Stopwatch.GetTimestamp();
        await harness.Server.StopAsync(CancellationToken.None);
        TimeSpan elapsed = Stopwatch.GetElapsedTime(started);

        elapsed.ShouldBeLessThan(TimeSpan.FromMilliseconds(harness.Options.ShutdownTimeoutMs + 1500));
        harness.Server.ActiveSessionCount.ShouldBe(0);

        // Both consumers see the tape they were promised and then a clean end of stream.
        (await first.IsClosedAsync(TimeSpan.FromSeconds(5))).ShouldBeTrue();
        (await second.IsClosedAsync(TimeSpan.FromSeconds(5))).ShouldBeTrue();

        harness.Metrics.ClosureSnapshot().Count.ShouldBe(2);
    }

    [Fact]
    public async Task Publish_after_shutdown_reaches_nobody()
    {
        await using FeedTestHarness harness = await FeedTestHarness.StartAsync();
        using FeedTestClient client = await harness.ConnectAsync();

        await harness.Server.StopAsync(CancellationToken.None);

        harness.Server.Publish(FeedTestHarness.MakeBatch(10)).ShouldBe(0);
    }

    [Fact]
    public async Task Options_are_validated_at_construction()
    {
        await using FeedTestHarness harness = await FeedTestHarness.StartAsync();

        Should.Throw<ArgumentException>(() => new FeedServer(
            new FeedServerOptions { ListenAddress = "not-an-address" }, harness.Logger));

        Should.Throw<ArgumentOutOfRangeException>(() => new FeedServer(
            new FeedServerOptions { MaxSessions = 0 }, harness.Logger));

        Should.Throw<ArgumentOutOfRangeException>(() => new FeedServer(
            new FeedServerOptions { SessionBufferBytes = 8 }, harness.Logger));
    }
}
