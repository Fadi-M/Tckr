using System.Diagnostics;
using System.Runtime.CompilerServices;
using Tckr.MockExchange.Protocol;
using Tckr.MockExchange.Options;
using Tckr.MockExchange.Reference;

namespace Tckr.MockExchange.Generation;

/// <summary>
/// The tape: a seeded, per-symbol random walk with mean reversion, a daily price band and a
/// configurable trade/quote mix, emitted in batches without allocating.
/// </summary>
/// <remarks>
/// <para>
/// Two properties are being bought here and only two. <b>Reproducibility</b>, so that a benchmark
/// taken in Phase 4 can be compared against one taken in Phase 16 &#8212; without it every
/// downstream measurement is a measurement of a different market. And <b>continuity</b>, so that
/// prices walk rather than teleport: Phase 3 onward asserts per-symbol ordering through Kafka
/// partitions, and against a tape of independent random prices a broken ordering guarantee and a
/// working one produce output that looks identical. Statistical realism beyond that is explicitly
/// not a goal; there is no volatility clustering here and no matching engine.
/// </para>
/// <para>
/// <b>Everything about a price is integer arithmetic.</b> Reference data arrives as
/// <see cref="decimal"/> and is scaled once, at session reset, into ticks-and-multiples form. From
/// then on the walk adds and subtracts whole ticks, the band bounds it clamps against are
/// themselves multiples of a tick, and the quotes are offsets in ticks from the mid &#8212; so
/// "every price is on the tick grid" is a consequence of the representation rather than a rounding
/// step that has to be got right 25,000 times a second. No <see cref="double"/> ever touches a
/// price; the only doubles in this file are probabilities, and they are converted to fixed point
/// in the constructor and never seen again.
/// </para>
/// <para>
/// <b>Cost per event.</b> Four 64-bit draws (a fifth on trade prints), each sliced into independent
/// fields; one alias-table pick; one clock read; a handful of multiplies and compares. No
/// division, no dictionary, no string, no branch on a symbol's identity, and no allocation. The
/// per-event cost is therefore independent of which symbol was drawn, which is what keeps Phase 4's
/// latency histograms from measuring the symbol distribution instead of the pipeline.
/// </para>
/// <para>
/// Not thread-safe: one generator, one generation loop, one RNG stream.
/// </para>
/// </remarks>
internal sealed class RandomWalkGenerator : IMarketDataGenerator
{
    /// <summary>Midpoint of the 32-bit coin range: an unbiased coin flip.</summary>
    private const ulong CoinHalf = 1UL << 31;

    /// <summary>Scale of a Q32 fixed-point probability: <c>2^32</c>.</summary>
    private const double Q32 = 4_294_967_296d;

    private const long NanosPerSecond = 1_000_000_000L;

    private const int BasisPointsPerUnit = 10_000;

    private readonly SymbolUniverse _universe;
    private readonly WeightedSymbolPicker _picker;
    private readonly Xoshiro256StarStar _rng;
    private readonly TimeProvider _timeProvider;

    /// <summary>Walking state, indexed by symbol index. Allocated once; never resized.</summary>
    private readonly SymbolState[] _states;

    /// <summary>
    /// The universe's packed symbols, copied into an array this type owns.
    /// </summary>
    /// <remarks>
    /// A copy rather than <c>_universe.PackedSymbols</c> per event: that property materialises a
    /// span from a field on every access, and the hot path should read one array it already holds
    /// rather than reach through another object to find it.
    /// </remarks>
    private readonly Symbol8[] _symbols;

    private readonly int _maxTickMove;
    private readonly int _tickMoveOutcomes;
    private readonly ulong _reversionStrengthQ32;
    private readonly int _minSpreadTicks;
    private readonly int _maxSpreadTicks;
    private readonly int _spreadOutcomes;
    private readonly int _minLots;
    private readonly int _lotOutcomes;
    private readonly int _blockMinLots;
    private readonly int _blockLotOutcomes;
    private readonly ulong _blockThresholdQ32;
    private readonly ulong _tradeThresholdQ32;
    private readonly ulong _bidThresholdQ32;
    private readonly long _bandBasisPoints;

    private readonly bool _deterministicTimestamps;
    private readonly long _deterministicStepNanos;
    private readonly long _deterministicEpochUnixNanos;

    /// <summary>Unix nanoseconds at the moment the clock was anchored, at startup.</summary>
    private long _anchorUnixNanos;

    /// <summary><see cref="Stopwatch.GetTimestamp"/> reading taken at the same moment.</summary>
    private long _anchorStopwatchTicks;

    /// <summary>
    /// Exact nanoseconds per stopwatch tick, or zero when the frequency does not divide
    /// 1,000,000,000 evenly and the slower conversion is needed.
    /// </summary>
    private readonly long _nanosPerStopwatchTick;

    /// <summary>The synthetic clock's next reading, when deterministic timestamps are enabled.</summary>
    private long _deterministicNanos;

    /// <summary>Whether a session has ever been opened, i.e. whether the walk has state to carry.</summary>
    private bool _hasOpened;

    /// <summary>Builds a generator over <paramref name="universe"/>. Allocates; call once, at startup.</summary>
    /// <param name="universe">The tradable universe. Symbols are addressed by index from here on.</param>
    /// <param name="options">Walk shape, message mix and seed. Defaults are used when null.</param>
    /// <param name="timeProvider">
    /// Wall clock, read exactly once to anchor the timestamp epoch; defaults to
    /// <see cref="TimeProvider.System"/>. It is deliberately <em>not</em> consulted per event, nor
    /// again at a session reset: see <see cref="NextTimestampNanos"/> and <see cref="AnchorClock"/>.
    /// </param>
    /// <exception cref="ArgumentOutOfRangeException">An option is outside its usable range.</exception>
    internal RandomWalkGenerator(
        SymbolUniverse universe,
        GenerationOptions? options = null,
        TimeProvider? timeProvider = null)
    {
        ArgumentNullException.ThrowIfNull(universe);

        options ??= new GenerationOptions();
        Validate(options);

        _universe = universe;
        _picker = universe.CreatePicker();
        _rng = new Xoshiro256StarStar(options.Seed);
        _timeProvider = timeProvider ?? TimeProvider.System;

        _states = new SymbolState[universe.Count];
        _symbols = universe.PackedSymbols.ToArray();

        _maxTickMove = options.MaxTickMove;
        _tickMoveOutcomes = options.MaxTickMove + 1; // a zero-tick move is a legitimate outcome
        _reversionStrengthQ32 = ToQ32(options.MeanReversionStrength);
        _minSpreadTicks = options.MinSpreadTicks;
        _maxSpreadTicks = options.MaxSpreadTicks;
        _spreadOutcomes = options.MaxSpreadTicks - options.MinSpreadTicks + 1;
        _minLots = options.MinLots;
        _lotOutcomes = options.MaxLots - options.MinLots + 1;
        _blockMinLots = options.BlockMinLots;
        _blockLotOutcomes = options.BlockMaxLots - options.BlockMinLots + 1;
        _blockThresholdQ32 = ToQ32(options.BlockTradeProbability);
        _bandBasisPoints = options.DailyBandBasisPoints;

        // The mix is normalised here rather than required to sum to one, so a configuration that
        // says 4 / 3 / 3 means the same thing as one that says 0.4 / 0.3 / 0.3. Two cumulative
        // thresholds turn the three-way choice into at most two integer compares per event.
        double mixTotal = options.TradeShare + options.BidQuoteShare + options.AskQuoteShare;
        _tradeThresholdQ32 = ToQ32(options.TradeShare / mixTotal);
        _bidThresholdQ32 = ToQ32((options.TradeShare + options.BidQuoteShare) / mixTotal);

        // Stopwatch.Frequency is 1e9 on Linux and macOS and 1e7 on Windows; both divide evenly, so
        // the common case is one multiply. The fallback exists because the frequency is a platform
        // detail we do not get to assume.
        _nanosPerStopwatchTick = NanosPerSecond % Stopwatch.Frequency == 0
            ? NanosPerSecond / Stopwatch.Frequency
            : 0;

        _deterministicTimestamps = options.DeterministicTimestamps;
        _deterministicStepNanos = options.DeterministicStepNanos;
        _deterministicEpochUnixNanos = options.DeterministicEpochUnixNanos;

        ResetSession();
    }

    /// <summary>Number of instruments the generator walks.</summary>
    internal int SymbolCount => _states.Length;

    /// <summary>Largest single price move, in ticks, as configured.</summary>
    internal int MaxTickMove => _maxTickMove;

    /// <summary>
    /// The walking state of every symbol, parallel to the universe's own ordering.
    /// </summary>
    /// <remarks>
    /// Exposed for diagnostics and tests &#8212; the band bounds and the tick grid live here and
    /// nowhere else, so a test that wants to assert "no price escaped its band" has to be able to
    /// read the band. Read-only by type: the array is the generator's, and a caller that mutated a
    /// symbol's state would corrupt the tape rather than fail.
    /// </remarks>
    internal ReadOnlySpan<SymbolState> States => _states;

    /// <inheritdoc />
    public void Generate(Span<FeedRecord> destination)
    {
        for (int i = 0; i < destination.Length; i++)
        {
            destination[i] = Next();
        }
    }

    /// <inheritdoc />
    public void ResetSession()
    {
        ReadOnlySpan<SymbolDefinition> definitions = _universe.Symbols;

        for (int i = 0; i < _states.Length; i++)
        {
            ref SymbolState state = ref _states[i];
            SymbolDefinition definition = definitions[i];

            long tick = PriceScale.ToScaled(definition.TickSize);

            // On the very first reset the walk has not run, so the anchor comes from reference
            // data; afterwards it is wherever the last session closed. Snapping happens here,
            // once, and is what makes every later price tick-aligned for free.
            long anchor = _hasOpened
                ? state.MidPriceScaled
                : SnapToTick(PriceScale.ToScaled(definition.ReferencePrice), tick);

            // The band half-width, floored onto the tick grid so that the bounds are themselves
            // valid prices and clamping cannot knock a price off the grid. Multiply before
            // dividing: the other order truncates the anchor to whole units of price first, which
            // would collapse the band of anything cheap.
            long span = anchor * _bandBasisPoints / BasisPointsPerUnit;
            span = span / tick * tick;

            // A band narrower than the widest quote would leave no room to place a two-sided
            // market inside it, and the quote shift below would then fight itself. Only binds for
            // an instrument whose tick is more than a few percent of its own price, which this
            // universe has none of; it is here so the invariant is structural rather than lucky.
            long minimumSpan = (long)_maxSpreadTicks * tick;
            if (span < minimumSpan)
            {
                span = minimumSpan;
            }

            long lower = anchor - span;
            long upper = anchor + span;

            // A price must stay strictly positive. Raising the floor without raising the ceiling
            // would narrow the band below the minimum just established, so move both.
            if (lower < tick)
            {
                lower = tick;
                upper = lower + (2 * span);
            }

            state.ReferencePriceScaled = anchor;
            state.MidPriceScaled = anchor;
            state.LastTradePriceScaled = anchor;
            state.LowerBandScaled = lower;
            state.UpperBandScaled = upper;
            state.ReversionSpanScaled = span;
            state.ReversionMultiplier = (ulong)(long.MaxValue / span);
            state.TickSizeScaled = tick;
            state.LotSize = definition.LotSize;
            state.TradesToday = 0;

            // An opening two-sided market, so a consumer that connects before the first quote
            // still sees a coherent book.
            state.BidScaled = anchor - tick;
            state.AskScaled = anchor + tick;
        }

        if (!_hasOpened)
        {
            AnchorClock();
            _hasOpened = true;
        }
    }

    /// <summary>Produces one record and advances the state of the symbol it belongs to.</summary>
    /// <remarks>
    /// Each 64-bit draw is split into two independent 32-bit fields. That is sound for
    /// xoshiro256**, whose output is uniform in every bit, and it halves the number of state
    /// transitions per event; it would not be sound for a generator with weak low bits.
    /// </remarks>
    private FeedRecord Next()
    {
        int index = _picker.Next(_rng.NextUInt64());
        ref SymbolState state = ref _states[index];

        ulong walk = _rng.NextUInt64();  // high: tick move magnitude   low: mean-reversion coin
        ulong micro = _rng.NextUInt64(); // high: spread width          low: message-type selector
        ulong size = _rng.NextUInt64();  // high: lot count             low: block-trade coin

        long tick = state.TickSizeScaled;

        // --- 1. the walk, in whole ticks --------------------------------------------------
        long move = (long)Lemire((uint)(walk >> 32), _tickMoveOutcomes);

        // Mean reversion: the further the price has travelled from the session anchor, the more
        // the next move is biased towards closing the gap. Proportional rather than a step
        // function at some threshold, so there is no distance at which the walk's behaviour
        // visibly changes; and expressed as a shift-multiply against a per-symbol reciprocal, so
        // it costs no division. `pull` is |deviation| / span in Q31, saturating at the band edge.
        long deviation = state.MidPriceScaled - state.ReferencePriceScaled;
        ulong pull = ((ulong)Math.Abs(deviation) * state.ReversionMultiplier) >> 32;
        if (pull > CoinHalf)
        {
            pull = CoinHalf;
        }

        ulong towardThreshold = CoinHalf + ((pull * _reversionStrengthQ32) >> 32);
        bool moveToward = (uint)walk < towardThreshold;

        // Above the anchor, closing the gap means moving down; at or below it, moving up.
        bool moveUp = moveToward ^ (deviation > 0);

        long mid = state.MidPriceScaled + (moveUp ? move * tick : -move * tick);

        // The band is a hard exchange-style limit. With the default reversion strength it fires
        // rarely; with reversion disabled it is the only thing holding the walk in.
        if (mid > state.UpperBandScaled)
        {
            mid = state.UpperBandScaled;
        }
        else if (mid < state.LowerBandScaled)
        {
            mid = state.LowerBandScaled;
        }

        state.MidPriceScaled = mid;

        // --- 2. top of book ---------------------------------------------------------------
        int spreadTicks = _minSpreadTicks + (int)Lemire((uint)(micro >> 32), _spreadOutcomes);

        // Rounding the half-spread up keeps Bid < Ask for an odd spread without a second branch:
        // a one-tick spread puts the bid one tick below the mid and the ask on it.
        long bid = mid - ((spreadTicks + 1) / 2 * tick);
        long ask = bid + (spreadTicks * tick);

        // Slide the whole quote back inside the band rather than clamping each side, which would
        // collapse the spread to zero at the boundary. The band is at least as wide as the widest
        // quote (established in ResetSession), so exactly one of these can fire.
        if (ask > state.UpperBandScaled)
        {
            long shift = ask - state.UpperBandScaled;
            bid -= shift;
            ask -= shift;
        }
        else if (bid < state.LowerBandScaled)
        {
            long shift = state.LowerBandScaled - bid;
            bid += shift;
            ask += shift;
        }

        state.BidScaled = bid;
        state.AskScaled = ask;

        // --- 3. quantity ------------------------------------------------------------------
        int lots = (uint)size < _blockThresholdQ32
            ? _blockMinLots + (int)Lemire((uint)(size >> 32), _blockLotOutcomes)
            : _minLots + (int)Lemire((uint)(size >> 32), _lotOutcomes);

        uint quantity = (uint)(lots * state.LotSize);

        // --- 4. message type and price ----------------------------------------------------
        uint typeCoin = (uint)micro;
        FeedMessageType messageType;
        long price;

        if (typeCoin < _tradeThresholdQ32)
        {
            messageType = FeedMessageType.Trade;

            // A print happens at or between the quotes: an aggressor crossing the spread, not a
            // price the book never showed. One extra draw, taken only on the ~40% of events that
            // need it.
            int step = (int)Lemire((uint)(_rng.NextUInt64() >> 32), spreadTicks + 1);
            price = bid + (step * tick);

            state.LastTradePriceScaled = price;
            state.TradesToday++;
        }
        else if (typeCoin < _bidThresholdQ32)
        {
            messageType = FeedMessageType.BidQuote;
            price = bid;
        }
        else
        {
            messageType = FeedMessageType.AskQuote;
            price = ask;
        }

        return new FeedRecord
        {
            MessageType = messageType,

            // Reserved zero. The only defined bit is FeedRecord.AuctionPrintFlag, and whether the
            // market is in an auction is the market session clock's knowledge (task 04), not the
            // generator's; wiring it in would mean this type taking a dependency on the phase
            // schedule to set one bit. Recorded as a request in task 03's notes rather than
            // guessed at here.
            Flags = 0,

            Quantity = quantity,

            // Left to the feed session (task 05), which assigns per connection at publish time.
            // See IMarketDataGenerator for why the split is where it is.
            SequenceNumber = 0,

            ExchangeTimestampNanos = NextTimestampNanos(),
            PriceScaled = price,
            Symbol = _symbols[index],
        };
    }

    /// <summary>
    /// The exchange-side event time: Unix nanoseconds from a monotonic clock anchored once, at
    /// startup.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <see cref="DateTime.UtcNow"/> is wrong here twice over. It is slow &#8212; on the order of
    /// tens of nanoseconds, which is the same order as the entire rest of an event &#8212; and it
    /// is not monotonic, so an NTP correction mid-run would emit a record timestamped before its
    /// predecessor and every downstream latency figure derived from it would go negative. Anchoring
    /// a wall-clock reading to <see cref="Stopwatch"/> once and measuring elapsed ticks from there
    /// gives a stream that is non-decreasing by construction. Equal consecutive values are allowed
    /// and expected: several events routinely fall inside one clock tick.
    /// </para>
    /// <para>
    /// The synthetic branch exists for the one case where a byte-identical tape is the point; see
    /// <c>GenerationOptions.DeterministicTimestamps</c>.
    /// </para>
    /// </remarks>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private long NextTimestampNanos()
    {
        if (_deterministicTimestamps)
        {
            long synthetic = _deterministicNanos;
            _deterministicNanos = synthetic + _deterministicStepNanos;
            return synthetic;
        }

        long elapsed = Stopwatch.GetTimestamp() - _anchorStopwatchTicks;

        return _nanosPerStopwatchTick != 0
            ? _anchorUnixNanos + (elapsed * _nanosPerStopwatchTick)
            : _anchorUnixNanos + ScaleTicksToNanos(elapsed);
    }

    /// <summary>
    /// Converts stopwatch ticks to nanoseconds when the frequency does not divide 1e9 evenly.
    /// </summary>
    /// <remarks>
    /// Split into whole seconds and a remainder rather than multiplying first: on a platform with
    /// a 1 GHz stopwatch, <c>elapsed &#215; 1e9</c> overflows a <see cref="long"/> after about
    /// nine seconds of uptime. Two divisions is a poor price to pay per event, which is exactly why
    /// the constructor takes the multiply-only path wherever it can.
    /// </remarks>
    private static long ScaleTicksToNanos(long elapsed)
    {
        long frequency = Stopwatch.Frequency;
        long seconds = elapsed / frequency;
        long remainder = elapsed - (seconds * frequency);
        return (seconds * NanosPerSecond) + (remainder * NanosPerSecond / frequency);
    }

    /// <summary>
    /// Pins the wall clock to the monotonic clock, once.
    /// </summary>
    /// <remarks>
    /// Deliberately not repeated on a session reset. Re-reading the wall clock at a session
    /// boundary would let an NTP step backwards between sessions emit a record timestamped before
    /// its predecessor, and "timestamps never decrease across the whole stream" is the one thing a
    /// consumer is entitled to assume without checking.
    /// </remarks>
    private void AnchorClock()
    {
        _anchorUnixNanos = _timeProvider.GetUtcNow().ToUnixTimeMilliseconds() * 1_000_000L;
        _anchorStopwatchTicks = Stopwatch.GetTimestamp();
        _deterministicNanos = _deterministicEpochUnixNanos;
    }

    /// <summary>
    /// Lemire's multiply-shift: a uniform value in <c>[0, outcomes)</c> from a 32-bit draw, with
    /// one multiply and no division.
    /// </summary>
    /// <remarks>
    /// The rejection step that would make this exactly uniform is deliberately omitted &#8212; see
    /// <see cref="Xoshiro256StarStar.NextInt"/>. Over the ranges drawn here the bias is under
    /// <c>outcomes / 2^32</c>, below one part in a billion, and the constant-time property is worth
    /// more than removing it.
    /// </remarks>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static uint Lemire(uint draw, int outcomes) => (uint)(draw * (ulong)(uint)outcomes >> 32);

    /// <summary>Rounds a positive scaled price onto the tick grid, never below one tick.</summary>
    private static long SnapToTick(long price, long tick)
    {
        long ticks = (price + (tick / 2)) / tick;
        return Math.Max(1, ticks) * tick;
    }

    /// <summary>Converts a probability in <c>[0, 1]</c> to a Q32 threshold.</summary>
    /// <remarks>
    /// Returns <c>2^32</c> for a probability of one, which is deliberately outside
    /// <see cref="uint"/>: the comparisons that use it widen the coin to <see cref="ulong"/>, so a
    /// probability of one means "always" rather than "all but one draw in four billion".
    /// </remarks>
    private static ulong ToQ32(double probability) => (ulong)Math.Round(probability * Q32);

    private static void Validate(GenerationOptions options)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(options.MaxTickMove, nameof(options.MaxTickMove));
        ArgumentOutOfRangeException.ThrowIfLessThan(options.DailyBandBasisPoints, 1, nameof(options.DailyBandBasisPoints));
        ArgumentOutOfRangeException.ThrowIfGreaterThan(options.DailyBandBasisPoints, BasisPointsPerUnit, nameof(options.DailyBandBasisPoints));
        ArgumentOutOfRangeException.ThrowIfLessThan(options.MinSpreadTicks, 1, nameof(options.MinSpreadTicks));
        ArgumentOutOfRangeException.ThrowIfLessThan(options.MaxSpreadTicks, options.MinSpreadTicks, nameof(options.MaxSpreadTicks));
        ArgumentOutOfRangeException.ThrowIfLessThan(options.MinLots, 1, nameof(options.MinLots));
        ArgumentOutOfRangeException.ThrowIfLessThan(options.MaxLots, options.MinLots, nameof(options.MaxLots));
        ArgumentOutOfRangeException.ThrowIfLessThan(options.BlockMinLots, 1, nameof(options.BlockMinLots));
        ArgumentOutOfRangeException.ThrowIfLessThan(options.BlockMaxLots, options.BlockMinLots, nameof(options.BlockMaxLots));
        ArgumentOutOfRangeException.ThrowIfNegative(options.DeterministicStepNanos, nameof(options.DeterministicStepNanos));

        if (options.MeanReversionStrength is < 0d or > 1d || double.IsNaN(options.MeanReversionStrength))
        {
            throw new ArgumentOutOfRangeException(
                nameof(options.MeanReversionStrength),
                options.MeanReversionStrength,
                "Mean reversion strength must be between 0 and 1 inclusive.");
        }

        RequireShare(options.TradeShare, nameof(options.TradeShare));
        RequireShare(options.BidQuoteShare, nameof(options.BidQuoteShare));
        RequireShare(options.AskQuoteShare, nameof(options.AskQuoteShare));

        if (options.TradeShare + options.BidQuoteShare + options.AskQuoteShare <= 0d)
        {
            throw new ArgumentOutOfRangeException(
                nameof(options.TradeShare),
                "The message mix is empty: at least one of the trade, bid and ask shares must be greater than zero.");
        }

        if (options.BlockTradeProbability is < 0d or > 1d || double.IsNaN(options.BlockTradeProbability))
        {
            throw new ArgumentOutOfRangeException(
                nameof(options.BlockTradeProbability),
                options.BlockTradeProbability,
                "Block trade probability must be between 0 and 1 inclusive.");
        }

        static void RequireShare(double share, string name)
        {
            if (share < 0d || double.IsNaN(share) || double.IsInfinity(share))
            {
                throw new ArgumentOutOfRangeException(
                    name, share, "A message-mix share must be a finite value of zero or more.");
            }
        }
    }
}
