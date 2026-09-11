using Tckr.MockExchange.Generation;
using Tckr.MockExchange.Options;
using Tckr.MockExchange.Protocol;
using Tckr.MockExchange.Reference;
using Xunit.Abstractions;
using Xunit.Sdk;

namespace Tckr.MockExchange.Tests.Generation;

/// <summary>
/// Tests for the tape.
/// </summary>
/// <remarks>
/// The large runs check their invariants with plain comparisons and throw on the first breach,
/// rather than calling into Shouldly a million times per assertion. The distinction matters here:
/// a suite that takes a minute to prove "no price left its band" gets run less often than one that
/// takes a second, and these are the properties most worth running often.
/// </remarks>
public class RandomWalkGeneratorTests(ITestOutputHelper output)
{
    private const ulong UniverseSeed = 0xC0FFEE_1234_5678UL;
    private const int BatchSize = 4096;

    /// <summary>Enough events for a distribution assertion to be about the generator, not luck.</summary>
    private const int LargeRun = 1_000_000;

    /// <summary>
    /// A universe whose band is only twenty ticks either side of the anchor, so the daily limit is
    /// reachable in a few hundred events instead of never.
    /// </summary>
    private const string NarrowBandUniverse = """
        { "symbols": [
            { "symbol": "NARROW", "name": "Narrow Band Co",
              "referencePrice": 10.00, "tickSize": 0.05, "lotSize": 100, "weight": 1.0 }
        ] }
        """;

    // ---------------------------------------------------------------- reproducibility

    [Fact]
    public void SameSeed_ProducesAnIdenticalTape()
    {
        // Deterministic timestamps are the only way "identical" can include every field: the
        // exchange timestamp comes from a wall clock, and a wall clock does not repeat.
        GenerationOptions options = DefaultOptions() with { DeterministicTimestamps = true };

        RandomWalkGenerator left = NewGenerator(options);
        RandomWalkGenerator right = NewGenerator(options);

        FeedRecord[] leftBatch = new FeedRecord[BatchSize];
        FeedRecord[] rightBatch = new FeedRecord[BatchSize];

        for (int emitted = 0; emitted < 100_000; emitted += BatchSize)
        {
            left.Generate(leftBatch);
            right.Generate(rightBatch);

            for (int i = 0; i < BatchSize; i++)
            {
                if (leftBatch[i] != rightBatch[i])
                {
                    throw new XunitException(
                        $"record {emitted + i} diverged: {leftBatch[i]} vs {rightBatch[i]}");
                }
            }
        }
    }

    [Fact]
    public void SameSeed_OnTheRealClock_ReproducesEveryFieldExceptTheTimestamp()
    {
        // The default configuration, which is what a benchmark run actually uses.
        RandomWalkGenerator left = NewGenerator(DefaultOptions());
        RandomWalkGenerator right = NewGenerator(DefaultOptions());

        FeedRecord[] leftBatch = new FeedRecord[BatchSize];
        FeedRecord[] rightBatch = new FeedRecord[BatchSize];

        left.Generate(leftBatch);
        right.Generate(rightBatch);

        for (int i = 0; i < BatchSize; i++)
        {
            FeedRecord a = leftBatch[i] with { ExchangeTimestampNanos = 0 };
            FeedRecord b = rightBatch[i] with { ExchangeTimestampNanos = 0 };
            a.ShouldBe(b, $"record {i} diverged");
        }
    }

    [Fact]
    public void DifferentSeeds_ProduceDifferentTapes()
    {
        GenerationOptions baseline = DefaultOptions() with { DeterministicTimestamps = true };

        RandomWalkGenerator left = NewGenerator(baseline);
        RandomWalkGenerator right = NewGenerator(baseline with { Seed = baseline.Seed + 1 });

        FeedRecord[] leftBatch = new FeedRecord[BatchSize];
        FeedRecord[] rightBatch = new FeedRecord[BatchSize];

        left.Generate(leftBatch);
        right.Generate(rightBatch);

        int identical = 0;
        for (int i = 0; i < BatchSize; i++)
        {
            if (leftBatch[i] == rightBatch[i])
            {
                identical++;
            }
        }

        // A handful of coincidental matches would be unremarkable; a tape that agrees anywhere near
        // half the time would mean the seed is not reaching the stream.
        output.WriteLine($"{identical} of {BatchSize} records coincided");
        identical.ShouldBeLessThan(BatchSize / 100);
    }

    /// <summary>
    /// A fingerprint over the first 100,000 records of the default tape.
    /// </summary>
    /// <remarks>
    /// The reproducibility tests above prove that two generators in one process agree. This one
    /// proves the tape has not changed since it was recorded, which is the property Phases 4, 9, 15
    /// and 16 depend on when they compare measurements taken months apart. A failure here is not
    /// necessarily a bug &#8212; but it does mean every published Phase 2 number was taken against a
    /// different market, so re-record it deliberately rather than by reflex.
    /// </remarks>
    [Fact]
    public void DefaultTape_MatchesItsRecordedFingerprint()
    {
        const ulong expected = 0xAB51487CA097DE11UL;

        RandomWalkGenerator generator = NewGenerator(DefaultOptions() with { DeterministicTimestamps = true });
        FeedRecord[] batch = new FeedRecord[BatchSize];

        ulong hash = 0xCBF2_9CE4_8422_2325UL; // FNV-1a offset basis
        for (int emitted = 0; emitted < 100_000; emitted += BatchSize)
        {
            generator.Generate(batch);
            foreach (FeedRecord record in batch)
            {
                hash = Mix(hash, (ulong)record.MessageType);
                hash = Mix(hash, record.Flags);
                hash = Mix(hash, record.Quantity);
                hash = Mix(hash, record.SequenceNumber);
                hash = Mix(hash, (ulong)record.ExchangeTimestampNanos);
                hash = Mix(hash, (ulong)record.PriceScaled);
                hash = Mix(hash, (ulong)(uint)record.Symbol.GetHashCode());
            }
        }

        output.WriteLine($"fingerprint: 0x{hash:X16}UL");
        hash.ShouldBe(expected, "the default tape changed");

        static ulong Mix(ulong hash, ulong value) => (hash ^ value) * 0x0000_0100_0000_01B3UL;
    }

    // ---------------------------------------------------------------- the walk

    [Fact]
    public void Continuity_APriceNeverMovesMoreThanMaxTickMoveInOneEvent()
    {
        SymbolUniverse universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, UniverseSeed);
        GenerationOptions options = DefaultOptions();
        RandomWalkGenerator generator = new(universe, options);

        long[] previousMid = new long[universe.Count];
        for (int i = 0; i < universe.Count; i++)
        {
            previousMid[i] = generator.States[i].MidPriceScaled;
        }

        long largestMoveInTicks = 0;
        FeedRecord[] single = new FeedRecord[1];

        for (int e = 0; e < 200_000; e++)
        {
            generator.Generate(single);

            if (!universe.TryGetIndex(single[0].Symbol, out int index))
            {
                throw new XunitException($"event {e} carried an unknown symbol");
            }

            SymbolState state = generator.States[index];
            long movedTicks = Math.Abs(state.MidPriceScaled - previousMid[index]) / state.TickSizeScaled;

            if (movedTicks > options.MaxTickMove)
            {
                throw new XunitException(
                    $"event {e} moved {single[0].SymbolAsString()} by {movedTicks} ticks, " +
                    $"more than the configured maximum of {options.MaxTickMove}");
            }

            largestMoveInTicks = Math.Max(largestMoveInTicks, movedTicks);
            previousMid[index] = state.MidPriceScaled;
        }

        output.WriteLine($"largest single move: {largestMoveInTicks} ticks (limit {options.MaxTickMove})");

        // A walk that never actually moves would satisfy the bound and prove nothing.
        largestMoveInTicks.ShouldBe(options.MaxTickMove);
    }

    [Fact]
    public void Band_NoPriceEscapesTheDailyLimit()
    {
        SymbolUniverse universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, UniverseSeed);
        RandomWalkGenerator generator = new(universe, DefaultOptions());

        // Bounds are fixed for the life of a session, so one snapshot is enough.
        SymbolState[] bounds = generator.States.ToArray();

        // Assert the stated percentage rather than only the generator's derived bound: checking a
        // price against a bound the same code produced would let a bug in the derivation pass.
        for (int i = 0; i < bounds.Length; i++)
        {
            SymbolState state = bounds[i];
            long limit = state.ReferencePriceScaled / 10; // 10%
            (state.ReferencePriceScaled - state.LowerBandScaled).ShouldBeLessThanOrEqualTo(limit);
            (state.UpperBandScaled - state.ReferencePriceScaled).ShouldBeLessThanOrEqualTo(limit);
        }

        ForEachRecord(generator, universe, LargeRun, (record, index) =>
        {
            SymbolState state = bounds[index];
            if (record.PriceScaled < state.LowerBandScaled || record.PriceScaled > state.UpperBandScaled)
            {
                return $"{record.SymbolAsString()} printed {record.Price}, outside " +
                       $"[{PriceScale.FromScaled(state.LowerBandScaled)}, {PriceScale.FromScaled(state.UpperBandScaled)}]";
            }

            return null;
        });
    }

    [Fact]
    public void Band_HoldsWhenTheWalkIsDrivenStraightIntoIt()
    {
        // With reversion switched off the walk is unbiased and the band is twenty ticks wide, so
        // the clamp is the only thing keeping the price in. That makes this the test that actually
        // exercises the clamp; on the real universe the band is hundreds of ticks away and is
        // reached only rarely.
        SymbolUniverse universe = SymbolUniverse.LoadFrom(NarrowBandUniverse, 1, 0, "narrow-band test");
        RandomWalkGenerator generator = new(universe, DefaultOptions() with { MeanReversionStrength = 0d });

        SymbolState opening = generator.States[0];
        long lower = opening.LowerBandScaled;
        long upper = opening.UpperBandScaled;

        long observedLow = long.MaxValue;
        long observedHigh = long.MinValue;

        ForEachRecord(generator, universe, 100_000, (record, _) =>
        {
            observedLow = Math.Min(observedLow, record.PriceScaled);
            observedHigh = Math.Max(observedHigh, record.PriceScaled);
            return record.PriceScaled < lower || record.PriceScaled > upper
                ? $"printed {record.Price}, outside [{PriceScale.FromScaled(lower)}, {PriceScale.FromScaled(upper)}]"
                : null;
        });

        output.WriteLine($"band [{lower}, {upper}]  observed [{observedLow}, {observedHigh}]");

        // If the walk never reached either bound the assertion above proved nothing.
        observedLow.ShouldBe(lower);
        observedHigh.ShouldBe(upper);
    }

    [Fact]
    public void FullStrengthReversion_StillRespectsTheBand()
    {
        // Strength 1.0 drives the Q32 threshold to exactly 2^32 at the band edge, which is the one
        // value that does not fit the coin's type. Worth pinning: an off-by-one there shows up as a
        // walk that leaks a tick past its limit.
        SymbolUniverse universe = SymbolUniverse.LoadFrom(NarrowBandUniverse, 1, 0, "narrow-band test");
        RandomWalkGenerator generator = new(universe, DefaultOptions() with { MeanReversionStrength = 1d });

        SymbolState opening = generator.States[0];

        ForEachRecord(generator, universe, 100_000, (record, _) =>
            record.PriceScaled < opening.LowerBandScaled || record.PriceScaled > opening.UpperBandScaled
                ? $"printed {record.Price} outside the band"
                : null);
    }

    [Fact]
    public void TickAlignment_EveryPriceIsAnExactMultipleOfTheSymbolTick()
    {
        SymbolUniverse universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, UniverseSeed);
        RandomWalkGenerator generator = new(universe, DefaultOptions());

        long[] ticks = new long[universe.Count];
        for (int i = 0; i < universe.Count; i++)
        {
            ticks[i] = PriceScale.ToScaled(universe[i].TickSize);
        }

        ForEachRecord(generator, universe, LargeRun, (record, index) =>
            record.PriceScaled % ticks[index] != 0
                ? $"{record.SymbolAsString()} printed {record.Price} off its {universe[index].TickSize} grid"
                : null);
    }

    [Fact]
    public void Spread_IsAlwaysPositiveAndWithinTheConfiguredRange()
    {
        SymbolUniverse universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, UniverseSeed);
        GenerationOptions options = DefaultOptions();
        RandomWalkGenerator generator = new(universe, options);

        bool[] spreadSeen = new bool[options.MaxSpreadTicks + 1];
        FeedRecord[] single = new FeedRecord[1];

        for (int e = 0; e < 200_000; e++)
        {
            generator.Generate(single);
            FeedRecord record = single[0];

            if (!universe.TryGetIndex(record.Symbol, out int index))
            {
                throw new XunitException($"event {e} carried an unknown symbol");
            }

            SymbolState state = generator.States[index];

            if (state.BidScaled >= state.AskScaled)
            {
                throw new XunitException($"event {e} crossed the book: {state.BidScaled} / {state.AskScaled}");
            }

            if (state.BidScaled <= 0)
            {
                throw new XunitException($"event {e} quoted a non-positive bid of {state.BidScaled}");
            }

            long spreadTicks = (state.AskScaled - state.BidScaled) / state.TickSizeScaled;
            if (spreadTicks < options.MinSpreadTicks || spreadTicks > options.MaxSpreadTicks)
            {
                throw new XunitException($"event {e} quoted a {spreadTicks}-tick spread");
            }

            spreadSeen[spreadTicks] = true;

            // The record must agree with the book it came from, or a consumer reconstructing
            // top-of-book from the tape would build a different book to the exchange's.
            long expected = record.MessageType switch
            {
                FeedMessageType.BidQuote => state.BidScaled,
                FeedMessageType.AskQuote => state.AskScaled,
                FeedMessageType.Trade => state.LastTradePriceScaled,
                _ => throw new XunitException($"the generator emitted {record.MessageType}"),
            };

            if (record.PriceScaled != expected)
            {
                throw new XunitException(
                    $"event {e} was a {record.MessageType} priced {record.PriceScaled}, book says {expected}");
            }

            if (record.MessageType == FeedMessageType.Trade &&
                (record.PriceScaled < state.BidScaled || record.PriceScaled > state.AskScaled))
            {
                throw new XunitException($"event {e} printed {record.PriceScaled} outside the quotes");
            }
        }

        // Every configured spread width must actually occur, or the range is narrower than it says.
        for (int width = options.MinSpreadTicks; width <= options.MaxSpreadTicks; width++)
        {
            spreadSeen[width].ShouldBeTrue($"no {width}-tick spread was ever quoted");
        }
    }

    // ---------------------------------------------------------------- record contents

    [Fact]
    public void MessageMix_MatchesTheConfiguredRatios()
    {
        SymbolUniverse universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, UniverseSeed);
        GenerationOptions options = DefaultOptions();
        RandomWalkGenerator generator = new(universe, options);

        int[] counts = new int[16];
        ForEachRecord(generator, universe, LargeRun, (record, _) =>
        {
            counts[(int)record.MessageType]++;
            return null;
        });

        double total = options.TradeShare + options.BidQuoteShare + options.AskQuoteShare;
        AssertShare(FeedMessageType.Trade, options.TradeShare / total);
        AssertShare(FeedMessageType.BidQuote, options.BidQuoteShare / total);
        AssertShare(FeedMessageType.AskQuote, options.AskQuoteShare / total);

        // Only the three tick types appear on a generated tape; heartbeats and the session-start
        // frame belong to the feed session, not to the market.
        (counts[(int)FeedMessageType.Trade] +
         counts[(int)FeedMessageType.BidQuote] +
         counts[(int)FeedMessageType.AskQuote]).ShouldBe(LargeRun);

        void AssertShare(FeedMessageType type, double expected)
        {
            double observed = counts[(int)type] / (double)LargeRun;
            output.WriteLine($"{type,-9}: expected {expected:P3}, observed {observed:P3}");
            (Math.Abs(observed - expected) / expected).ShouldBeLessThan(0.01, $"{type} share");
        }
    }

    [Fact]
    public void Quantity_IsAlwaysAPositiveWholeNumberOfLots()
    {
        SymbolUniverse universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, UniverseSeed);
        GenerationOptions options = DefaultOptions();
        RandomWalkGenerator generator = new(universe, options);

        int blocks = 0;
        ForEachRecord(generator, universe, LargeRun, (record, index) =>
        {
            uint lotSize = (uint)universe[index].LotSize;

            if (record.Quantity == 0 || record.Quantity % lotSize != 0)
            {
                return $"{record.SymbolAsString()} quantity {record.Quantity} is not a whole number of {lotSize}-share lots";
            }

            long lots = record.Quantity / lotSize;
            if (lots > options.MaxLots)
            {
                blocks++;
                return lots < options.BlockMinLots || lots > options.BlockMaxLots
                    ? $"block of {lots} lots is outside [{options.BlockMinLots}, {options.BlockMaxLots}]"
                    : null;
            }

            return lots < options.MinLots ? $"order of {lots} lots is below the minimum" : null;
        });

        double blockShare = blocks / (double)LargeRun;
        output.WriteLine($"block trades: {blocks:N0} ({blockShare:P3}), configured {options.BlockTradeProbability:P3}");
        blockShare.ShouldBe(options.BlockTradeProbability, options.BlockTradeProbability * 0.05);
    }

    [Fact]
    public void SequenceNumber_IsLeftForTheFeedSessionToAssign()
    {
        SymbolUniverse universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, UniverseSeed);
        RandomWalkGenerator generator = new(universe, DefaultOptions());

        // Numbering is per connection and counts the records a session was offered, so the tape
        // cannot carry it: one tape feeds many sessions, each with its own numbering.
        ForEachRecord(generator, universe, 100_000, (record, _) =>
            record.SequenceNumber != 0 ? $"the generator assigned sequence number {record.SequenceNumber}" : null);
    }

    [Fact]
    public void Flags_AreReservedZeroUntilThePhaseClockIsWiredIn()
    {
        SymbolUniverse universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, UniverseSeed);
        RandomWalkGenerator generator = new(universe, DefaultOptions());

        ForEachRecord(generator, universe, 100_000, (record, _) =>
            record.Flags != 0 ? $"the generator set flags 0x{record.Flags:X4}" : null);
    }

    // ---------------------------------------------------------------- timestamps

    [Fact]
    public void Timestamps_NeverDecrease()
    {
        SymbolUniverse universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, UniverseSeed);
        RandomWalkGenerator generator = new(universe, DefaultOptions());

        long previous = long.MinValue;
        long first = 0;
        long last = 0;
        int seen = 0;

        ForEachRecord(generator, universe, LargeRun, (record, _) =>
        {
            long now = record.ExchangeTimestampNanos;
            if (now < previous)
            {
                return $"record {seen} is timestamped {previous - now} ns before its predecessor";
            }

            if (seen == 0)
            {
                first = now;
            }

            previous = now;
            last = now;
            seen++;
            return null;
        });

        output.WriteLine($"span: {(last - first) / 1_000_000d:F1} ms over {LargeRun:N0} events");
        last.ShouldBeGreaterThan(first, "the clock never advanced at all");

        // Sanity that the anchor is a real wall-clock reading and not, say, ticks since boot.
        DateTimeOffset.FromUnixTimeMilliseconds(first / 1_000_000)
            .ShouldBeInRange(DateTimeOffset.UtcNow.AddMinutes(-5), DateTimeOffset.UtcNow.AddMinutes(5));
    }

    [Fact]
    public void Timestamps_SurviveASessionResetWithoutGoingBackwards()
    {
        SymbolUniverse universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, UniverseSeed);
        IMarketDataGenerator generator = new RandomWalkGenerator(universe, DefaultOptions());

        FeedRecord[] batch = new FeedRecord[BatchSize];
        generator.Generate(batch);
        long beforeReset = batch[^1].ExchangeTimestampNanos;

        generator.ResetSession();

        generator.Generate(batch);
        batch[0].ExchangeTimestampNanos.ShouldBeGreaterThanOrEqualTo(beforeReset);
    }

    [Fact]
    public void DeterministicTimestamps_AdvanceByTheConfiguredStep()
    {
        SymbolUniverse universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, UniverseSeed);
        GenerationOptions options = DefaultOptions() with { DeterministicTimestamps = true };
        RandomWalkGenerator generator = new(universe, options);

        FeedRecord[] batch = new FeedRecord[BatchSize];
        generator.Generate(batch);

        batch[0].ExchangeTimestampNanos.ShouldBe(options.DeterministicEpochUnixNanos);
        for (int i = 1; i < batch.Length; i++)
        {
            (batch[i].ExchangeTimestampNanos - batch[i - 1].ExchangeTimestampNanos)
                .ShouldBe(options.DeterministicStepNanos);
        }
    }

    // ---------------------------------------------------------------- allocation

    [Fact]
    public void Generate_AllocatesNothing()
    {
        SymbolUniverse universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, UniverseSeed);

        // Through the interface, because that is how the publisher (task 06) calls it: a boxing
        // conversion or a hidden state machine on that path would not show up otherwise.
        IMarketDataGenerator generator = new RandomWalkGenerator(universe, DefaultOptions());
        FeedRecord[] buffer = new FeedRecord[BatchSize];

        // Warm up: the first call JITs Generate and everything it inlines, which allocates.
        generator.Generate(buffer);

        const int batches = LargeRun / BatchSize;
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < batches; i++)
        {
            generator.Generate(buffer);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.ShouldBe(0L, $"generating {batches * BatchSize:N0} events allocated {allocated} bytes");
    }

    // ---------------------------------------------------------------- sessions

    [Fact]
    public void ResetSession_ReAnchorsEachSymbolWhereItsPriceCurrentlyIs()
    {
        SymbolUniverse universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, UniverseSeed);
        RandomWalkGenerator generator = new(universe, DefaultOptions());

        FeedRecord[] batch = new FeedRecord[BatchSize];
        for (int i = 0; i < 20; i++)
        {
            generator.Generate(batch);
        }

        long[] closing = new long[universe.Count];
        bool anyTraded = false;
        bool anyMoved = false;
        for (int i = 0; i < universe.Count; i++)
        {
            SymbolState state = generator.States[i];
            closing[i] = state.MidPriceScaled;
            anyTraded |= state.TradesToday > 0;
            anyMoved |= state.MidPriceScaled != state.ReferencePriceScaled;
        }

        anyTraded.ShouldBeTrue();
        anyMoved.ShouldBeTrue("nothing moved, so re-anchoring cannot be observed");

        ((IMarketDataGenerator)generator).ResetSession();

        for (int i = 0; i < universe.Count; i++)
        {
            SymbolState state = generator.States[i];

            state.ReferencePriceScaled.ShouldBe(closing[i], $"symbol {i} did not open where it closed");
            state.MidPriceScaled.ShouldBe(closing[i]);
            state.LastTradePriceScaled.ShouldBe(closing[i]);
            state.TradesToday.ShouldBe(0u);

            // The band travels with the anchor; that is the point of re-anchoring.
            state.LowerBandScaled.ShouldBeLessThan(closing[i]);
            state.UpperBandScaled.ShouldBeGreaterThan(closing[i]);
        }
    }

    [Fact]
    public void ResetSession_OnAFreshGenerator_ChangesNothing()
    {
        SymbolUniverse universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, UniverseSeed);
        RandomWalkGenerator generator = new(universe, DefaultOptions());

        SymbolState[] opening = generator.States.ToArray();
        ((IMarketDataGenerator)generator).ResetSession();

        for (int i = 0; i < opening.Length; i++)
        {
            generator.States[i].ReferencePriceScaled.ShouldBe(opening[i].ReferencePriceScaled);
            generator.States[i].UpperBandScaled.ShouldBe(opening[i].UpperBandScaled);
            generator.States[i].LowerBandScaled.ShouldBe(opening[i].LowerBandScaled);
        }
    }

    [Fact]
    public void OpeningState_MatchesTheReferenceDataOnTheTickGrid()
    {
        SymbolUniverse universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, UniverseSeed);
        RandomWalkGenerator generator = new(universe, DefaultOptions());

        generator.SymbolCount.ShouldBe(universe.Count);
        generator.MaxTickMove.ShouldBe(GenerationOptions.DefaultMaxTickMove);

        for (int i = 0; i < universe.Count; i++)
        {
            SymbolDefinition definition = universe[i];
            SymbolState state = generator.States[i];
            long tick = PriceScale.ToScaled(definition.TickSize);

            state.TickSizeScaled.ShouldBe(tick);
            state.LotSize.ShouldBe(definition.LotSize);
            (state.ReferencePriceScaled % tick).ShouldBe(0L);

            // Snapping to the grid may move the anchor by up to half a tick, and no further.
            Math.Abs(state.ReferencePriceScaled - PriceScale.ToScaled(definition.ReferencePrice))
                .ShouldBeLessThanOrEqualTo(tick / 2);

            state.BidScaled.ShouldBeLessThan(state.AskScaled);
            state.MidPriceScaled.ShouldBe(state.ReferencePriceScaled);

            // The band is symmetric about the anchor and exactly one reversion span wide either
            // side; the mean-reversion reciprocal is derived from that span and nothing else.
            state.ReversionSpanScaled.ShouldBe(state.UpperBandScaled - state.ReferencePriceScaled);
            state.ReversionSpanScaled.ShouldBe(state.ReferencePriceScaled - state.LowerBandScaled);
            state.ReversionMultiplier.ShouldBe((ulong)(long.MaxValue / state.ReversionSpanScaled));
        }
    }

    [Fact]
    public void Generate_AcceptsAnEmptySpan()
    {
        SymbolUniverse universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, UniverseSeed);
        IMarketDataGenerator generator = new RandomWalkGenerator(universe, DefaultOptions());

        Should.NotThrow(() => generator.Generate(Span<FeedRecord>.Empty));
    }

    // ---------------------------------------------------------------- configuration

    [Fact]
    public void Constructor_RejectsAMissingUniverse()
        => Should.Throw<ArgumentNullException>(() => new RandomWalkGenerator(null!));

    [Fact]
    public void Constructor_RejectsUnusableOptions()
    {
        SymbolUniverse universe = SymbolUniverse.Load(8, UniverseSeed);

        (string Because, GenerationOptions Options)[] cases =
        [
            ("a negative tick move", new GenerationOptions { MaxTickMove = -1 }),
            ("a zero-width band", new GenerationOptions { DailyBandBasisPoints = 0 }),
            ("a band as wide as the price", new GenerationOptions { DailyBandBasisPoints = 10_001 }),
            ("a spread that permits a crossed book", new GenerationOptions { MinSpreadTicks = 0 }),
            ("an inverted spread range", new GenerationOptions { MinSpreadTicks = 4, MaxSpreadTicks = 3 }),
            ("a zero-lot order", new GenerationOptions { MinLots = 0 }),
            ("an inverted lot range", new GenerationOptions { MinLots = 5, MaxLots = 4 }),
            ("an inverted block range", new GenerationOptions { BlockMinLots = 100, BlockMaxLots = 99 }),
            ("reversion stronger than certainty", new GenerationOptions { MeanReversionStrength = 1.5 }),
            ("negative reversion", new GenerationOptions { MeanReversionStrength = -0.1 }),
            ("an impossible probability", new GenerationOptions { BlockTradeProbability = 2 }),
            ("a negative message-mix share", new GenerationOptions { BidQuoteShare = -1 }),
            ("an empty message mix", new GenerationOptions { TradeShare = 0, BidQuoteShare = 0, AskQuoteShare = 0 }),
            ("time running backwards", new GenerationOptions { DeterministicStepNanos = -1 }),
        ];

        foreach ((string because, GenerationOptions options) in cases)
        {
            Should.Throw<ArgumentOutOfRangeException>(
                () => new RandomWalkGenerator(universe, options), $"the generator accepted {because}");
        }
    }

    [Fact]
    public void MessageMix_CanBeNarrowedToASingleType()
    {
        SymbolUniverse universe = SymbolUniverse.Load(32, UniverseSeed);
        RandomWalkGenerator generator = new(
            universe,
            DefaultOptions() with { TradeShare = 0, BidQuoteShare = 1, AskQuoteShare = 0 });

        ForEachRecord(generator, universe, 50_000, (record, _) =>
            record.MessageType != FeedMessageType.BidQuote ? $"emitted a {record.MessageType}" : null);
    }

    [Fact]
    public void AFrozenMarket_EmitsRecordsWithoutMovingAnyPrice()
    {
        // MaxTickMove = 0 is a legitimate configuration and the boundary of the tick-move draw.
        SymbolUniverse universe = SymbolUniverse.Load(16, UniverseSeed);
        RandomWalkGenerator generator = new(universe, DefaultOptions() with { MaxTickMove = 0 });

        long[] opening = new long[universe.Count];
        for (int i = 0; i < universe.Count; i++)
        {
            opening[i] = generator.States[i].MidPriceScaled;
        }

        FeedRecord[] batch = new FeedRecord[BatchSize];
        generator.Generate(batch);

        for (int i = 0; i < universe.Count; i++)
        {
            generator.States[i].MidPriceScaled.ShouldBe(opening[i]);
        }
    }

    // ---------------------------------------------------------------- helpers

    /// <summary>
    /// The options every test starts from: the shipped defaults with a fixed seed, so a failure is
    /// a bug rather than an unlucky run.
    /// </summary>
    private static GenerationOptions DefaultOptions() => new() { Seed = 0xA11CE_5EED_1234UL };

    private static RandomWalkGenerator NewGenerator(GenerationOptions options) =>
        new(SymbolUniverse.Load(SymbolUniverse.DefaultSize, UniverseSeed), options);

    /// <summary>
    /// Runs <paramref name="count"/> events through <paramref name="inspect"/> in reusable batches,
    /// passing each record's universe index alongside it, and fails on the first non-null message
    /// it returns.
    /// </summary>
    private static void ForEachRecord(
        RandomWalkGenerator generator,
        SymbolUniverse universe,
        int count,
        Func<FeedRecord, int, string?> inspect)
    {
        FeedRecord[] batch = new FeedRecord[BatchSize];

        for (int emitted = 0; emitted < count; emitted += BatchSize)
        {
            int take = Math.Min(BatchSize, count - emitted);
            Span<FeedRecord> span = batch.AsSpan(0, take);
            generator.Generate(span);

            for (int i = 0; i < take; i++)
            {
                if (!universe.TryGetIndex(span[i].Symbol, out int index))
                {
                    throw new XunitException(
                        $"record {emitted + i} carried '{span[i].SymbolAsString()}', which is not in the universe");
                }

                string? failure = inspect(span[i], index);
                if (failure is not null)
                {
                    throw new XunitException($"record {emitted + i}: {failure}");
                }
            }
        }
    }
}
