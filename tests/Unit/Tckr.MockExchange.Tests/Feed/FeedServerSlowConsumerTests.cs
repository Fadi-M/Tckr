using System.Collections.Concurrent;
using System.Diagnostics;
using Tckr.MockExchange.Feed;
using Tckr.MockExchange.Protocol;
using Xunit.Abstractions;

namespace Tckr.MockExchange.Tests.Feed;

/// <summary>
/// The behaviour the whole component exists to prove: a consumer that cannot keep up must not slow
/// the exchange down, must not affect any other consumer, and must be dealt with unambiguously.
/// </summary>
public sealed class FeedServerSlowConsumerTests(ITestOutputHelper output)
{
    private static readonly TimeSpan Generous = TimeSpan.FromSeconds(15);

    [Fact]
    public async Task A_stalled_consumer_is_disconnected_logged_and_counted()
    {
        await using FeedTestHarness harness = await FeedTestHarness.StartAsync(o =>
        {
            o.SessionBufferBytes = 64 * 1024;
            o.SlowConsumerTimeoutMs = 500;
            o.SendBufferSize = 4096;
        });

        using FeedTestClient stalled = await harness.ConnectStalledAsync();

        FeedRecord[] batch = FeedTestHarness.MakeBatch(100);
        long onset = 0;

        await FeedTestHarness.WaitForAsync(
            () =>
            {
                if (harness.Server.Publish(batch) == 0 && onset == 0)
                {
                    // The first batch the session refuses is the moment it was found to be behind.
                    onset = Stopwatch.GetTimestamp();
                }

                return harness.Server.ActiveSessionCount == 0;
            },
            Generous,
            "the stalled session to be disconnected");

        onset.ShouldNotBe(0, "the session should have refused a batch before it was closed");

        TimeSpan sinceOnset = Stopwatch.GetElapsedTime(onset);
        sinceOnset.ShouldBeLessThan(TimeSpan.FromMilliseconds(harness.Options.SlowConsumerTimeoutMs * 2));

        harness.Metrics.SlowConsumerDisconnects.ShouldBe(1);

        IReadOnlyList<(Guid SessionId, string Reason)> closures = harness.Metrics.ClosureSnapshot();

        output.WriteLine(
            $"Disconnected {sinceOnset.TotalMilliseconds:F0} ms after backpressure was detected "
            + $"(timeout {harness.Options.SlowConsumerTimeoutMs} ms), reason "
            + $"'{(closures.Count == 1 ? closures[0].Reason : "?")}'.");

        closures.Count.ShouldBe(1);
        closures[0].Reason.ShouldBeOneOf(
            FeedSession.Reasons.SlowConsumer, FeedSession.Reasons.SlowConsumerLoss);

        harness.HasLoggedReason(reason => reason.StartsWith("slow-consumer"))
            .ShouldBeTrue("the disconnect reason must be logged");
    }

    [Fact]
    public async Task Publish_does_not_block_on_a_stalled_session()
    {
        await using FeedTestHarness harness = await FeedTestHarness.StartAsync(o =>
        {
            o.SessionBufferBytes = 64 * 1024;
            o.SlowConsumerTimeoutMs = 3000;
            o.SendBufferSize = 4096;
        });

        using FeedTestClient stalled = await harness.ConnectStalledAsync();

        FeedRecord[] batch = FeedTestHarness.MakeBatch(125);
        double worstMs = 0;
        double totalMs = 0;
        const int iterations = 500;

        for (int i = 0; i < iterations; i++)
        {
            long started = Stopwatch.GetTimestamp();
            harness.Server.Publish(batch);
            double elapsedMs = Stopwatch.GetElapsedTime(started).TotalMilliseconds;

            totalMs += elapsedMs;
            worstMs = Math.Max(worstMs, elapsedMs);
        }

        output.WriteLine(
            $"{iterations} publishes of {batch.Length} records against a stalled session: "
            + $"worst {worstMs:F3} ms, mean {totalMs / iterations:F4} ms, total {totalMs:F1} ms.");

        // Roughly 62,500 records offered to a consumer that has not read a byte. If Publish were
        // coupled to the socket at all, this loop would sit on the slow-consumer timeout instead.
        worstMs.ShouldBeLessThan(50, "Publish must never wait on a consumer's socket");
        totalMs.ShouldBeLessThan(harness.Options.SlowConsumerTimeoutMs);
    }

    [Fact]
    public async Task A_stalled_consumer_does_not_cost_a_healthy_one_a_single_frame()
    {
        await using FeedTestHarness harness = await FeedTestHarness.StartAsync(o =>
        {
            o.SessionBufferBytes = 128 * 1024;
            o.SlowConsumerTimeoutMs = 1000;
            o.SendBufferSize = 8 * 1024;
        });

        using FeedTestClient stalled = await harness.ConnectStalledAsync();
        using FeedTestClient healthy = await harness.ConnectAsync(receiveBufferSize: 128 * 1024);

        const int batches = 200;
        const int perBatch = 50;
        const int expected = batches * perBatch;

        Task<List<FeedRecord>> reader = Task.Run(() => healthy.ReadTicksAsync(expected, Generous));

        FeedRecord[] batch = FeedTestHarness.MakeBatch(perBatch);
        int reachedBoth = 0;

        for (int i = 0; i < batches; i++)
        {
            if (harness.Server.Publish(batch) == 2)
            {
                reachedBoth++;
            }

            await Task.Delay(1);
        }

        List<FeedRecord> ticks = await reader;

        // The healthy consumer's tape is complete and in order. Not "mostly": every frame.
        ticks.Count.ShouldBe(expected);
        for (int i = 0; i < expected; i++)
        {
            ticks[i].SequenceNumber.ShouldBe((ulong)(i + 1));
        }

        reachedBoth.ShouldBeLessThan(batches, "the stalled session should have stopped taking batches");
        output.WriteLine(
            $"Stalled session took {reachedBoth} of {batches} batches; the healthy session took all "
            + $"{expected} records with no gap.");

        await FeedTestHarness.WaitForAsync(
            () => harness.Server.ActiveSessionCount == 1, Generous, "the stalled session to be dropped");

        harness.Metrics.SlowConsumerDisconnects.ShouldBe(1);

        // And the healthy session is still live afterwards.
        harness.Server.Publish(FeedTestHarness.MakeBatch(2)).ShouldBe(1);
        List<FeedRecord> more = await healthy.ReadTicksAsync(2, Generous);
        more[0].SequenceNumber.ShouldBe((ulong)(expected + 1));
        more[1].SequenceNumber.ShouldBe((ulong)(expected + 2));
    }

    [Fact]
    public async Task DropOldest_cannot_rescue_a_socket_that_has_wedged_and_still_disconnects()
    {
        await using FeedTestHarness harness = await FeedTestHarness.StartAsync(o =>
        {
            o.SlowConsumerPolicy = SlowConsumerPolicy.DropOldest;
            o.SessionBufferBytes = 64 * 1024;
            o.SlowConsumerTimeoutMs = 500;
            o.SendBufferSize = 4096;
        });

        using FeedTestClient stalled = await harness.ConnectStalledAsync();

        FeedRecord[] batch = FeedTestHarness.MakeBatch(100);

        await FeedTestHarness.WaitForAsync(
            () =>
            {
                harness.Server.Publish(batch);
                return harness.Server.ActiveSessionCount == 0;
            },
            Generous,
            "the wedged session to be disconnected even under DropOldest");

        // Freeing our own buffer does nothing for a peer that has stopped reading altogether, so
        // even the lenient policy ends in a disconnect. That is worth asserting, because the
        // opposite belief - "DropOldest means the session survives" - is the tempting one.
        harness.Metrics.SlowConsumerDisconnects.ShouldBe(1);
    }

    [Fact]
    public async Task DropOldest_recovers_and_leaves_a_gap_exactly_the_size_of_what_was_lost()
    {
        await using FeedTestHarness harness = await FeedTestHarness.StartAsync(o =>
        {
            o.SlowConsumerPolicy = SlowConsumerPolicy.DropOldest;
            o.SessionBufferBytes = 64 * 1024;

            // Generous, so the consumer below is unambiguously "slow" and not "wedged": the point
            // of this test is the recovery path, not the timeout path.
            o.SlowConsumerTimeoutMs = 5000;
            o.SendBufferSize = 4096;
        });

        FeedTestClient client = await harness.ConnectAsync();

        const int perBatch = 100;
        FeedRecord[] batch = FeedTestHarness.MakeBatch(perBatch);

        // Every record handed to Publish is a record *offered* to this session, and every offered
        // record consumes a sequence number whether or not the session can take it. This counter is
        // the test's model of the session's numbering.
        int offered = 0;

        // Phase one: the consumer reads nothing, so the buffer fills and the session starts
        // refusing. Keep offering past that point, so records are demonstrably withheld.
        int refusals = 0;
        while (offered < 500_000 && refusals < 5)
        {
            if (harness.Server.Publish(batch) == 0)
            {
                refusals++;
            }

            offered += perBatch;
        }

        refusals.ShouldBe(5, "the session should have refused batches once its buffer filled");
        harness.Server.ActiveSessionCount.ShouldBe(1);

        // Phase two: the consumer starts reading, the session recovers instead of being closed.
        using CancellationTokenSource stop = new();
        ConcurrentQueue<ulong> received = new();

        Task drain = Task.Run(async () =>
        {
            try
            {
                while (!stop.IsCancellationRequested)
                {
                    DecodedFrame frame = await client.ReadFrameAsync(TimeSpan.FromMilliseconds(500));
                    if (frame.Type == FeedMessageType.Trade)
                    {
                        received.Enqueue(FeedFrameReader.ReadTick(frame.Payload).SequenceNumber);
                    }
                }
            }
            catch (Exception)
            {
                // Ends when the test stops publishing and the reads time out.
            }
        });

        await FeedTestHarness.WaitForAsync(
            () => !received.IsEmpty, Generous, "the consumer to start draining its backlog");

        await FeedTestHarness.WaitForAsync(
            () =>
            {
                bool taken = harness.Server.Publish(batch) == 1;
                offered += perBatch;
                return taken;
            },
            Generous,
            "the session to take batches again");

        // Phase three: one final record, taken by a session that is running again. Its sequence
        // number is the assertion: it must be the total offered, not the total written.
        await FeedTestHarness.WaitForAsync(
            () =>
            {
                bool taken = harness.Server.Publish(FeedTestHarness.MakeBatch(1)) == 1;
                offered++;
                return taken;
            },
            Generous,
            "a final single record to be accepted");

        ulong finalSequence = (ulong)offered;

        await FeedTestHarness.WaitForAsync(
            () => received.Contains(finalSequence),
            Generous,
            $"the final record to arrive numbered {finalSequence}");

        // Let the socket go quiet so nothing is still in flight when the arithmetic below runs.
        await FeedTestHarness.WaitForAsync(
            () => HasGoneQuiet(received), Generous, "the stream to go quiet");

        await stop.CancelAsync();
        await drain;

        int delivered = received.Count;
        long dropped = harness.Metrics.TotalRecordsDropped;

        output.WriteLine(
            $"DropOldest: {offered} records offered, {delivered} delivered, {dropped} counted as dropped; "
            + $"the last frame is numbered {received.Last()} of {offered}.");

        harness.Server.ActiveSessionCount.ShouldBe(1, "DropOldest keeps a session that is merely slow");
        harness.Metrics.SlowConsumerDisconnects.ShouldBe(0);
        dropped.ShouldBeGreaterThan(0, "the loss must be counted, not swallowed");

        // The whole point of the new numbering. The last record offered carries sequence number
        // `offered`, so numbering counts what the session was shown, not what it managed to send.
        received.Last().ShouldBe(finalSequence);

        // And the hole in the consumer's view is exactly the size of the loss the server counted -
        // no more (which would mean we lost something we did not admit to) and no less (which would
        // mean the gap understates the damage).
        (offered - delivered).ShouldBe((int)dropped);
    }

    /// <summary>Samples the queue's length twice a beat apart; unchanged means nothing more is arriving.</summary>
    private static bool HasGoneQuiet(ConcurrentQueue<ulong> queue)
    {
        int before = queue.Count;
        Thread.Sleep(150);
        return queue.Count == before;
    }

    [Fact]
    public async Task A_faulted_session_does_not_take_the_server_or_its_neighbours_with_it()
    {
        await using FeedTestHarness harness = await FeedTestHarness.StartAsync();

        FeedTestClient doomed = await harness.ConnectAsync();
        using FeedTestClient survivor = await harness.ConnectAsync(receiveBufferSize: 128 * 1024);

        harness.Server.Publish(FeedTestHarness.MakeBatch(5)).ShouldBe(2);
        await survivor.ReadTicksAsync(5, Generous);

        doomed.Kill();

        await FeedTestHarness.WaitForAsync(
            () =>
            {
                harness.Server.Publish(FeedTestHarness.MakeBatch(10));
                return harness.Server.ActiveSessionCount == 1;
            },
            Generous,
            "the dead session to be removed");

        // The survivor's own numbering is untouched by anything that happened to its neighbour.
        int published = 0;
        while (harness.Server.Publish(FeedTestHarness.MakeBatch(1)) == 1 && published < 3)
        {
            published++;
        }

        published.ShouldBe(3);

        List<FeedRecord> ticks = await survivor.ReadTicksAsync(1, Generous);
        ticks[0].SequenceNumber.ShouldBeGreaterThan(5UL);
    }
}
