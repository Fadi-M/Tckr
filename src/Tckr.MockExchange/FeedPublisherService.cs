using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Tckr.MockExchange.Diagnostics;
using Tckr.MockExchange.Feed;
using Tckr.MockExchange.Generation;
using Tckr.MockExchange.Options;
using Tckr.MockExchange.Protocol;
using Tckr.MockExchange.Session;

namespace Tckr.MockExchange;

/// <summary>
/// The generation loop: advance the session clock, ask the governor how many events this batch
/// owes, fill a buffer with them, and hand it to every connected consumer.
/// </summary>
/// <remarks>
/// <para>
/// This is the component that makes the exchange's central behavioural promise true — generation
/// runs at its configured rate regardless of who is connected or how slow they are. Nothing in
/// this loop awaits a consumer: <see cref="FeedServer.Publish"/> is synchronous, non-blocking, and
/// returns how many sessions took the batch rather than waiting for the ones that could not.
/// </para>
/// <para>
/// It also owns the feed server's lifetime rather than leaving the ordering to registration order
/// in <c>Program.cs</c>. The listener must be bound before the first batch is published and closed
/// after the last one, and expressing that as "these two <c>AddHostedService</c> calls are in the
/// right order" is a constraint nobody reading the file can see. Here it is two lines of
/// <see cref="StartAsync"/> and <see cref="StopAsync"/>.
/// </para>
/// </remarks>
internal sealed class FeedPublisherService : BackgroundService
{
    /// <summary>Floor on the batch buffer, so a tiny configured rate still gets a usable array.</summary>
    internal const int MinBatchCapacity = 64;

    /// <summary>
    /// Ceiling on the batch buffer: roughly 10 MB of records.
    /// </summary>
    /// <remarks>
    /// A configuration asking for more than this per batch gets several passes over a bounded
    /// buffer instead of one pass over an unbounded one. The loop is already correct for that
    /// case, and a gigabyte-scale array sized from a mistyped rate is not.
    /// </remarks>
    internal const int MaxBatchCapacity = 262_144;

    /// <summary>Name given to the dedicated generation thread, so it is identifiable in a stack dump.</summary>
    internal const string PublisherThreadName = "mockexchange-publisher";

    private readonly IMarketDataGenerator _generator;
    private readonly MarketSessionClock _clock;
    private readonly RateGovernor _governor;
    private readonly FeedServer _server;
    private readonly FeedMetrics _metrics;
    private readonly ILogger<FeedPublisherService> _logger;
    private readonly TimeProvider _timeProvider;

    private readonly MockExchangeOptions _options;
    private readonly double _baseEventsPerSecond;

    /// <summary>The one buffer the loop ever writes into. Allocated here and never replaced.</summary>
    private readonly FeedRecord[] _batch;

    public FeedPublisherService(
        IOptions<MockExchangeOptions> options,
        IMarketDataGenerator generator,
        MarketSessionClock clock,
        RateGovernor governor,
        FeedServer server,
        FeedMetrics metrics,
        ILogger<FeedPublisherService> logger,
        TimeProvider timeProvider)
    {
        ArgumentNullException.ThrowIfNull(options);

        _options = options.Value;
        _generator = generator ?? throw new ArgumentNullException(nameof(generator));
        _clock = clock ?? throw new ArgumentNullException(nameof(clock));
        _governor = governor ?? throw new ArgumentNullException(nameof(governor));
        _server = server ?? throw new ArgumentNullException(nameof(server));
        _metrics = metrics ?? throw new ArgumentNullException(nameof(metrics));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));

        _baseEventsPerSecond = _options.Session.BaseEventsPerSecond;
        _batch = new FeedRecord[CalculateBatchCapacity(_options.Session)];

        // Late bind, not a constructor argument: the server takes the metrics, so the metrics
        // cannot take the server. Until this is called the sessions.active gauge answers from the
        // accept/close ledger, which is correct but derived.
        _metrics.BindSessionCount(() => _server.ActiveSessionCount);

        _clock.PhaseChanged += OnPhaseChanged;
    }

    /// <summary>Records the loop is prepared to emit in a single pass.</summary>
    internal int BatchCapacity => _batch.Length;

    /// <summary>
    /// Sizes the batch buffer from the fastest rate the configuration can ever ask for.
    /// </summary>
    /// <remarks>
    /// The peak is the rate ceiling rather than the base rate, because a phase multiplier can take
    /// the base rate up to it, and the headroom is the catch-up cap, because a single batch is
    /// allowed to make up that many missed ones. Sizing for the base rate instead would be correct
    /// but would put the multi-pass path — the slow one — on the opening auction, which is exactly
    /// the moment it should not be there.
    /// </remarks>
    internal static int CalculateBatchCapacity(MarketSessionOptions session)
    {
        ArgumentNullException.ThrowIfNull(session);

        double peakEventsPerSecond = Math.Max(session.MaxEventsPerSecond, session.BaseEventsPerSecond);
        double perBatch = peakEventsPerSecond * session.BatchIntervalMs / 1000d;
        double withCatchUp = perBatch * (1 + session.MaxCatchUpBatches);

        if (double.IsNaN(withCatchUp) || withCatchUp <= MinBatchCapacity)
        {
            return MinBatchCapacity;
        }

        return withCatchUp >= MaxBatchCapacity ? MaxBatchCapacity : (int)Math.Ceiling(withCatchUp);
    }

    /// <summary>Binds the listener, logs the run's identity, then starts the loop.</summary>
    public override async Task StartAsync(CancellationToken cancellationToken)
    {
        await _server.StartAsync(cancellationToken).ConfigureAwait(false);

        // After the bind, not before: with Port 0 the configured endpoint and the bound one are
        // different, and the bound one is the only one a consumer can connect to.
        StartupSummary.Log(
            _logger,
            _options.Generation.Seed,
            _generator is RandomWalkGenerator walk ? walk.SymbolCount : _options.Generation.UniverseSize,
            _baseEventsPerSecond,
            _options.Session.Mode.ToString(),
            _server.LocalEndPoint?.ToString() ?? "(unbound)");

        WarnIfMixIsNotNormalised();

        await base.StartAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Stops the loop, then drains and closes the sessions.</summary>
    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        try
        {
            await base.StopAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            // In a finally because a loop that failed still leaves a bound listener and open
            // sockets, and leaking those turns one bad run into a port conflict on the next.
            await _server.StopAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    /// <inheritdoc />
    public override void Dispose()
    {
        _clock.PhaseChanged -= OnPhaseChanged;
        base.Dispose();
    }

    /// <summary>
    /// Hands the loop to a dedicated thread rather than running it on the thread pool.
    /// </summary>
    /// <remarks>
    /// The governor closes the last two milliseconds to each deadline by spinning, on whichever
    /// thread called it. On a pool thread that is a worker taken out of circulation 200 times a
    /// second for up to 2 ms at a time, which the pool responds to by injecting more threads —
    /// so the cost lands on everything else in the process rather than on the loop that chose it.
    /// <c>TaskCreationOptions.LongRunning</c> would not fix it either: it dedicates a thread only
    /// until the first <c>await</c>, after which continuations go back to the pool. A real thread
    /// and a blocking wait is the honest expression of "this loop occupies its thread by design".
    /// </remarks>
    protected override Task ExecuteAsync(CancellationToken stoppingToken)
    {
        TaskCompletionSource completion = new(TaskCreationOptions.RunContinuationsAsynchronously);

        Thread thread = new(() => RunGuarded(completion, stoppingToken))
        {
            IsBackground = true,
            Name = PublisherThreadName,
        };

        thread.Start();
        return completion.Task;
    }

    private void RunGuarded(TaskCompletionSource completion, CancellationToken ct)
    {
        try
        {
            Run(ct);
            completion.SetResult();
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Normal shutdown. The governor throws this out of its wait when the token trips.
            completion.SetResult();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "The publisher loop stopped with an error. The exchange is no longer generating.");
            completion.SetException(ex);
        }
    }

    /// <summary>The loop. Allocates nothing per event and nothing per batch.</summary>
    private void Run(CancellationToken ct)
    {
        FeedRecord[] batch = _batch;

        while (!ct.IsCancellationRequested)
        {
            // Advance before asking for the batch, not after: the rate handed to the governor is
            // the rate this batch is paced at.
            _clock.Advance(_timeProvider.GetUtcNow());

            double rate = _clock.EffectiveEventsPerSecond(_baseEventsPerSecond);
            _metrics.SetTarget(_clock.CurrentPhase, rate);

            int count = WaitForNextBatch(rate, ct);
            _metrics.RecordPacingLag(_governor.CurrentLag);

            // Zero is legitimate: a Closed phase, or a rate low enough that the debt has not yet
            // reached one whole event. It is not end-of-stream, and it does not want a delay of
            // our own around it — the governor is the pacer.
            if (count == 0)
            {
                continue;
            }

            _metrics.RecordBatch(count);

            bool auction = IsAuctionPhase(_clock.CurrentPhase);

            for (int emitted = 0; emitted < count;)
            {
                int take = Math.Min(count - emitted, batch.Length);
                Span<FeedRecord> span = batch.AsSpan(0, take);

                _generator.Generate(span);

                if (auction)
                {
                    StampAuctionPrints(span);
                }

                int reached = _server.Publish(span);
                _metrics.RecordPublished(take, reached);

                emitted += take;
            }
        }
    }

    /// <summary>
    /// Blocks the dedicated thread until the next batch is due.
    /// </summary>
    /// <remarks>
    /// Sync-over-async, deliberately and safely: this thread exists to be occupied, there is no
    /// synchronization context in a worker host to deadlock against, and the alternative — an
    /// async loop — hands the wait back to the pool and takes the spin with it. The fast path
    /// avoids <c>AsTask</c> entirely for the case the governor already knows the answer, which is
    /// every batch that woke late.
    /// </remarks>
    private int WaitForNextBatch(double eventsPerSecond, CancellationToken ct)
    {
        ValueTask<int> pending = _governor.WaitForNextBatchAsync(eventsPerSecond, ct);

        return pending.IsCompletedSuccessfully
            ? pending.Result
            : pending.AsTask().GetAwaiter().GetResult();
    }

    /// <summary>
    /// Marks the trades in a batch as auction prints.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Set here rather than in the generator because whether a print came from an auction is the
    /// session clock's knowledge, not the tape's, and this loop is the only thing holding both the
    /// clock and the record buffer. The rejected alternative was a <see cref="MarketPhase"/>
    /// parameter on <see cref="IMarketDataGenerator.Generate"/>, which puts phase knowledge inside
    /// the component that has the least use for it.
    /// </para>
    /// <para>
    /// The decision is taken once per batch rather than per record. A batch is 5 ms and a phase
    /// lasts minutes, so the worst error the whole-batch decision can make is one batch's worth of
    /// records mislabelled at a phase boundary.
    /// </para>
    /// <para>
    /// Quotes are left alone. An auction print is a print: flagging a bid update as one would
    /// describe something that does not exist.
    /// </para>
    /// </remarks>
    internal static void StampAuctionPrints(Span<FeedRecord> batch)
    {
        for (int i = 0; i < batch.Length; i++)
        {
            if (batch[i].MessageType == FeedMessageType.Trade)
            {
                batch[i] = batch[i] with { Flags = (ushort)(batch[i].Flags | FeedRecord.AuctionPrintFlag) };
            }
        }
    }

    /// <summary>The two phases whose prints are crosses rather than continuous trades.</summary>
    internal static bool IsAuctionPhase(MarketPhase phase) =>
        phase is MarketPhase.OpeningAuction or MarketPhase.ClosingAuction;

    private void OnPhaseChanged(MarketPhase previous, MarketPhase current) =>
        _logger.LogInformation(
            "Market phase {PreviousPhase} -> {MarketPhase}, rate multiplier {RateMultiplier:F2} ({EffectiveEventsPerSecond:F0} events/sec).",
            previous,
            current,
            _clock.CurrentRateMultiplier,
            _clock.EffectiveEventsPerSecond(_baseEventsPerSecond));

    /// <summary>
    /// Warns when the message mix does not sum to one.
    /// </summary>
    /// <remarks>
    /// The generator normalises the mix, so <c>4 / 3 / 3</c> and <c>0.4 / 0.3 / 0.3</c> are the
    /// same configuration and neither is an error. That is also what makes this worth a line: a
    /// mix of <c>0.4 / 0.3 / 0.2</c> was almost certainly meant to be <c>0.4 / 0.3 / 0.3</c>, and
    /// silently becomes 44/33/22 instead. Rejecting it at start-up would make the legitimate
    /// integer-share form unusable; saying what it actually resolved to costs one line and catches
    /// the typo.
    /// </remarks>
    private void WarnIfMixIsNotNormalised()
    {
        GenerationOptions generation = _options.Generation;
        double total = generation.TradeShare + generation.BidQuoteShare + generation.AskQuoteShare;

        if (Math.Abs(total - 1d) <= 1e-6)
        {
            return;
        }

        _logger.LogWarning(
            "Message mix shares sum to {MixTotal} rather than 1.0. They are normalised, so the tape will be "
            + "{TradePercent:P1} trades / {BidPercent:P1} bids / {AskPercent:P1} asks. If that is not what was "
            + "intended, the shares are MockExchange:Generation:TradeShare, BidQuoteShare and AskQuoteShare.",
            total,
            generation.TradeShare / total,
            generation.BidQuoteShare / total,
            generation.AskQuoteShare / total);
    }
}
