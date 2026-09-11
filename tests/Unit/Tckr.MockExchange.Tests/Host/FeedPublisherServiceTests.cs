using Tckr.MockExchange.Options;
using Tckr.MockExchange.Protocol;
using Tckr.MockExchange.Session;

namespace Tckr.MockExchange.Tests.Host;

/// <summary>
/// The two decisions the publisher loop makes on its own: how big the batch buffer is, and which
/// records are auction prints.
/// </summary>
public class FeedPublisherServiceTests
{
    [Fact]
    public void TheBatchBufferIsSizedFromTheRateCeilingNotTheBaseRate()
    {
        MarketSessionOptions session = new()
        {
            BaseEventsPerSecond = 25_000,
            MaxEventsPerSecond = 100_000,
            BatchIntervalMs = 5,
            MaxCatchUpBatches = 4,
        };

        // 100,000/sec x 5 ms = 500 per batch, x (1 + 4) batches of catch-up headroom.
        FeedPublisherService.CalculateBatchCapacity(session).ShouldBe(2_500);
    }

    /// <remarks>
    /// A phase multiplier can take the base rate all the way to the ceiling, so sizing for the
    /// base rate would put the multi-pass path on the opening auction — the one moment it should
    /// not be there.
    /// </remarks>
    [Fact]
    public void ABaseRateAboveTheCeilingStillGetsABufferThatFitsIt()
    {
        MarketSessionOptions session = new()
        {
            BaseEventsPerSecond = 200_000,
            MaxEventsPerSecond = 100_000,
            BatchIntervalMs = 5,
            MaxCatchUpBatches = 0,
        };

        FeedPublisherService.CalculateBatchCapacity(session).ShouldBe(1_000);
    }

    [Fact]
    public void AVerySmallRateStillGetsAUsableBuffer()
    {
        MarketSessionOptions session = new()
        {
            BaseEventsPerSecond = 1,
            MaxEventsPerSecond = 1,
            BatchIntervalMs = 1,
            MaxCatchUpBatches = 0,
        };

        FeedPublisherService.CalculateBatchCapacity(session).ShouldBe(FeedPublisherService.MinBatchCapacity);
    }

    /// <remarks>
    /// The loop emits in several passes over a bounded buffer rather than allocating one sized
    /// from a mistyped rate, so the ceiling is a real bound and not a suggestion.
    /// </remarks>
    [Fact]
    public void AnAbsurdRateIsCappedRatherThanAllocatedFor()
    {
        MarketSessionOptions session = new()
        {
            BaseEventsPerSecond = 100_000_000,
            MaxEventsPerSecond = 100_000_000,
            BatchIntervalMs = 100,
            MaxCatchUpBatches = 1_000,
        };

        FeedPublisherService.CalculateBatchCapacity(session).ShouldBe(FeedPublisherService.MaxBatchCapacity);
    }

    [Fact]
    public void OnlyTheAuctionPhasesProduceAuctionPrints()
    {
        FeedPublisherService.IsAuctionPhase(MarketPhase.OpeningAuction).ShouldBeTrue();
        FeedPublisherService.IsAuctionPhase(MarketPhase.ClosingAuction).ShouldBeTrue();

        foreach (MarketPhase phase in Enum.GetValues<MarketPhase>()
                     .Where(p => p is not (MarketPhase.OpeningAuction or MarketPhase.ClosingAuction)))
        {
            FeedPublisherService.IsAuctionPhase(phase).ShouldBeFalse($"{phase} is not an auction.");
        }
    }

    /// <remarks>
    /// An auction print is a print. Flagging a bid update as one would describe something that
    /// does not happen, and Phase 3's normalisation would have to decide what to do with it.
    /// </remarks>
    [Fact]
    public void StampingAnAuctionBatchMarksTradesAndLeavesQuotesAlone()
    {
        FeedRecord[] batch =
        [
            MakeRecord(FeedMessageType.Trade),
            MakeRecord(FeedMessageType.BidQuote),
            MakeRecord(FeedMessageType.AskQuote),
            MakeRecord(FeedMessageType.Trade),
        ];

        FeedPublisherService.StampAuctionPrints(batch);

        batch[0].IsAuctionPrint.ShouldBeTrue();
        batch[1].IsAuctionPrint.ShouldBeFalse();
        batch[2].IsAuctionPrint.ShouldBeFalse();
        batch[3].IsAuctionPrint.ShouldBeTrue();
    }

    [Fact]
    public void StampingIsIdempotentAndPreservesOtherFlags()
    {
        const ushort otherFlag = 0x0100;

        FeedRecord[] batch = [MakeRecord(FeedMessageType.Trade) with { Flags = otherFlag }];

        FeedPublisherService.StampAuctionPrints(batch);
        FeedPublisherService.StampAuctionPrints(batch);

        batch[0].IsAuctionPrint.ShouldBeTrue();
        (batch[0].Flags & otherFlag).ShouldBe(otherFlag);
    }

    private static FeedRecord MakeRecord(FeedMessageType type) => new()
    {
        MessageType = type,
        Flags = 0,
        Quantity = 100,
        SequenceNumber = 0,
        ExchangeTimestampNanos = 1_700_000_000_000_000_000L,
        PriceScaled = PriceScale.ToScaled(85.10m),
        Symbol = Symbol8.FromAscii("COMI"),
    };
}
