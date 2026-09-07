using System.Buffers;
using Tckr.MockExchange.Protocol;

namespace Tckr.MockExchange.Tests.Protocol;

public class FeedFrameWriterTests
{
    // 2023-11-14T22:13:20.123456789Z, chosen so every byte of the timestamp field is distinct.
    private const long SampleNanos = 1_700_000_000_123_456_789L;

    private static FeedRecord SampleTick() => new()
    {
        MessageType = FeedMessageType.Trade,
        Flags = 0,
        Quantity = 100,
        SequenceNumber = 1,
        ExchangeTimestampNanos = SampleNanos,
        PriceScaled = PriceScale.ToScaled(85.10m),
        Symbol = Symbol8.FromAscii("COMI"),
    };

    /// <summary>
    /// The regression guard for the wire contract. Phase 3 is written against these exact bytes,
    /// so a field reordering that round-trips perfectly is still a breaking change; only a
    /// hard-coded expectation catches it.
    /// </summary>
    [Fact]
    public void TickFrameMatchesTheFrozenByteLayout()
    {
        byte[] expected =
        [
            0x28, 0x00, 0x00, 0x00,                          // length prefix = 40
            0x01,                                            // version
            0x01,                                            // message type = Trade
            0x00, 0x00,                                      // flags
            0x64, 0x00, 0x00, 0x00,                          // quantity = 100
            0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,  // sequence = 1
            0x15, 0xCD, 0x85, 0x3D, 0xFE, 0x9C, 0x97, 0x17,  // timestamp nanos
            0x38, 0xFC, 0x0C, 0x00, 0x00, 0x00, 0x00, 0x00,  // price = 851000 (85.1000)
            0x43, 0x4F, 0x4D, 0x49, 0x20, 0x20, 0x20, 0x20,  // "COMI    "
        ];

        Span<byte> buffer = stackalloc byte[FeedFrameWriter.TickFrameSize];
        int written = FeedFrameWriter.WriteTick(buffer, SampleTick());

        written.ShouldBe(44);
        buffer.ToArray().ShouldBe(expected);
    }

    // Parameterised over the raw byte because xUnit only discovers public test methods, and a
    // public signature cannot name an internal enum.
    [Theory]
    [InlineData((byte)1)]
    [InlineData((byte)2)]
    [InlineData((byte)3)]
    public void TickRoundTripsThroughTheCodec(byte messageType)
    {
        FeedRecord original = SampleTick() with
        {
            MessageType = (FeedMessageType)messageType,
            Flags = FeedRecord.AuctionPrintFlag,
            Quantity = 4_294_967_295,
            SequenceNumber = ulong.MaxValue,
            PriceScaled = PriceScale.ToScaled(999_999.9999m),
            Symbol = Symbol8.FromAscii("BRK.B"),
        };

        Span<byte> buffer = stackalloc byte[FeedFrameWriter.TickFrameSize];
        FeedFrameWriter.WriteTick(buffer, original);

        FeedRecord decoded = FeedFrameReader.ReadTick(
            buffer[FeedFrameWriter.LengthPrefixSize..]);

        decoded.ShouldBe(original);
        decoded.IsAuctionPrint.ShouldBeTrue();
        decoded.SymbolAsString().ShouldBe("BRK.B");
        decoded.Price.ShouldBe(999_999.9999m);
    }

    [Fact]
    public void HeartbeatRoundTrips()
    {
        Span<byte> buffer = stackalloc byte[FeedFrameWriter.HeartbeatFrameSize];
        int written = FeedFrameWriter.WriteHeartbeat(buffer, lastSeq: 987, timestampNanos: SampleNanos);

        written.ShouldBe(28);
        FeedFrameReader.ReadHeartbeat(
            buffer[FeedFrameWriter.LengthPrefixSize..], out ulong lastSeq, out long nanos);

        lastSeq.ShouldBe(987UL);
        nanos.ShouldBe(SampleNanos);
    }

    [Fact]
    public void SessionStartRoundTripsTheGuidInRfc4122ByteOrder()
    {
        var sessionId = new Guid("00112233-4455-6677-8899-aabbccddeeff");

        Span<byte> buffer = stackalloc byte[FeedFrameWriter.SessionStartFrameSize];
        int written = FeedFrameWriter.WriteSessionStart(buffer, sessionId, heartbeatMs: 1000, startNanos: SampleNanos);

        written.ShouldBe(36);

        // Big-endian on the wire: the first field reads left to right, unlike .NET's native layout.
        buffer.Slice(FeedFrameWriter.LengthPrefixSize + 8, 4).ToArray()
            .ShouldBe(new byte[] { 0x00, 0x11, 0x22, 0x33 });

        FeedFrameReader.ReadSessionStart(
            buffer[FeedFrameWriter.LengthPrefixSize..],
            out Guid decodedId,
            out uint heartbeatMs,
            out long startNanos);

        decodedId.ShouldBe(sessionId);
        heartbeatMs.ShouldBe(1000U);
        startNanos.ShouldBe(SampleNanos);
    }

    [Theory]
    [InlineData(FeedFrameWriter.TickFrameSize, FeedFrameWriter.TickPayloadSize)]
    [InlineData(FeedFrameWriter.HeartbeatFrameSize, FeedFrameWriter.HeartbeatPayloadSize)]
    [InlineData(FeedFrameWriter.SessionStartFrameSize, FeedFrameWriter.SessionStartPayloadSize)]
    public void FrameSizeIsAlwaysPayloadPlusPrefix(int frameSize, int payloadSize)
    {
        frameSize.ShouldBe(payloadSize + FeedFrameWriter.LengthPrefixSize);
    }

    [Fact]
    public void LengthPrefixDeclaresThePayloadSizeForEveryMessageType()
    {
        byte[] tick = new byte[FeedFrameWriter.TickFrameSize];
        byte[] heartbeat = new byte[FeedFrameWriter.HeartbeatFrameSize];
        byte[] sessionStart = new byte[FeedFrameWriter.SessionStartFrameSize];

        FeedFrameWriter.WriteTick(tick, SampleTick());
        FeedFrameWriter.WriteHeartbeat(heartbeat, 0, SampleNanos);
        FeedFrameWriter.WriteSessionStart(sessionStart, Guid.NewGuid(), 1000, SampleNanos);

        System.Buffers.Binary.BinaryPrimitives.ReadUInt32LittleEndian(tick).ShouldBe(40U);
        System.Buffers.Binary.BinaryPrimitives.ReadUInt32LittleEndian(heartbeat).ShouldBe(24U);
        System.Buffers.Binary.BinaryPrimitives.ReadUInt32LittleEndian(sessionStart).ShouldBe(32U);
    }

    [Theory]
    [InlineData("A", "A")]
    [InlineData("COMI", "COMI")]
    [InlineData("ABCDEFGH", "ABCDEFGH")]
    public void SymbolIsPaddedOnWriteAndTrimmedOnRead(string symbol, string expected)
    {
        FeedRecord original = SampleTick() with { Symbol = Symbol8.FromAscii(symbol) };

        Span<byte> buffer = stackalloc byte[FeedFrameWriter.TickFrameSize];
        FeedFrameWriter.WriteTick(buffer, original);

        ReadOnlySpan<byte> symbolField = buffer.Slice(FeedFrameWriter.LengthPrefixSize + 32, 8);
        for (int i = symbol.Length; i < 8; i++)
        {
            symbolField[i].ShouldBe((byte)' ');
        }

        FeedRecord decoded = FeedFrameReader.ReadTick(buffer[FeedFrameWriter.LengthPrefixSize..]);
        decoded.SymbolAsString().ShouldBe(expected);
        decoded.Symbol.TrimmedLength.ShouldBe(symbol.Length);
    }

    [Theory]
    [InlineData("")]
    [InlineData("TOOLONGXX")]
    [InlineData("AB CD")]
    [InlineData("ABé")]
    public void RejectsSymbolsThatCannotBeEncodedUnambiguously(string symbol)
    {
        Should.Throw<ArgumentException>(() => Symbol8.FromAscii(symbol));
    }

    [Fact]
    public void RejectsAnEmbeddedSpaceOnRead()
    {
        Span<byte> buffer = stackalloc byte[FeedFrameWriter.TickFrameSize];
        FeedFrameWriter.WriteTick(buffer, SampleTick());
        buffer[FeedFrameWriter.LengthPrefixSize + 32 + 2] = (byte)' '; // "CO MI" on the wire

        byte[] corrupted = buffer.ToArray();
        Should.Throw<InvalidDataException>(
            () => FeedFrameReader.ReadTick(corrupted.AsSpan(FeedFrameWriter.LengthPrefixSize)));
    }

    [Theory]
    [InlineData((byte)10)]
    [InlineData((byte)11)]
    public void RefusesToWriteASessionMessageTypeAsATick(byte messageType)
    {
        FeedRecord bad = SampleTick() with { MessageType = (FeedMessageType)messageType };
        byte[] buffer = new byte[FeedFrameWriter.TickFrameSize];

        Should.Throw<ArgumentException>(() => FeedFrameWriter.WriteTick(buffer, bad));
    }

    [Fact]
    public void ThrowsWhenTheDestinationIsTooSmall()
    {
        byte[] tooSmall = new byte[FeedFrameWriter.TickFrameSize - 1];
        FeedRecord tick = SampleTick();

        Should.Throw<ArgumentException>(() => FeedFrameWriter.WriteTick(tooSmall, tick));
        Should.Throw<ArgumentException>(() => FeedFrameWriter.WriteHeartbeat(new byte[27], 0, 0));
        Should.Throw<ArgumentException>(() => FeedFrameWriter.WriteSessionStart(new byte[35], Guid.NewGuid(), 1000, 0));
    }

    /// <summary>
    /// The encode path runs 25,000 times a second for the life of a benchmark. Anything it
    /// allocates lands as GC pressure inside the latency numbers Phase 4 onward is trying to
    /// measure, so zero is the only acceptable figure.
    /// </summary>
    [Fact]
    public void EncodingIsAllocationFree()
    {
        Span<byte> buffer = stackalloc byte[FeedFrameWriter.TickFrameSize];
        FeedRecord tick = SampleTick();

        // Warm up so JIT and tiering work is not counted against the measured window.
        for (int i = 0; i < 128; i++)
        {
            FeedFrameWriter.WriteTick(buffer, in tick);
            FeedFrameWriter.WriteHeartbeat(buffer, 1, SampleNanos);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();

        for (int i = 0; i < 10_000; i++)
        {
            FeedFrameWriter.WriteTick(buffer, in tick);
        }

        long after = GC.GetAllocatedBytesForCurrentThread();

        (after - before).ShouldBe(0);
    }

    /// <summary>The decode path is on Phase 3's hot path, so it carries the same requirement.</summary>
    [Fact]
    public void DecodingIsAllocationFree()
    {
        Span<byte> buffer = stackalloc byte[FeedFrameWriter.TickFrameSize];
        FeedFrameWriter.WriteTick(buffer, SampleTick());
        ReadOnlySpan<byte> payload = buffer[FeedFrameWriter.LengthPrefixSize..];

        for (int i = 0; i < 128; i++)
        {
            _ = FeedFrameReader.ReadTick(payload);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();

        for (int i = 0; i < 10_000; i++)
        {
            _ = FeedFrameReader.ReadTick(payload);
        }

        long after = GC.GetAllocatedBytesForCurrentThread();

        (after - before).ShouldBe(0);
    }

    [Fact]
    public void SymbolsCompareAndHashByValue()
    {
        Symbol8 a = Symbol8.FromAscii("COMI");
        Symbol8 b = Symbol8.FromAscii("COMI");
        Symbol8 c = Symbol8.FromAscii("HRHO");

        a.ShouldBe(b);
        (a == b).ShouldBeTrue();
        (a != c).ShouldBeTrue();
        a.GetHashCode().ShouldBe(b.GetHashCode());
    }
}
