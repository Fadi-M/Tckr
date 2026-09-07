using System.Buffers;
using System.Buffers.Binary;
using Tckr.MockExchange.Protocol;

namespace Tckr.MockExchange.Tests.Protocol;

public class FeedFrameReaderTests
{
    private const long SampleNanos = 1_700_000_000_123_456_789L;

    private static FeedRecord Tick(ulong sequence, string symbol = "COMI") => new()
    {
        MessageType = FeedMessageType.Trade,
        Flags = 0,
        Quantity = 100,
        SequenceNumber = sequence,
        ExchangeTimestampNanos = SampleNanos + (long)sequence,
        PriceScaled = PriceScale.ToScaled(85.10m),
        Symbol = Symbol8.FromAscii(symbol),
    };

    private static byte[] EncodeTicks(int count)
    {
        byte[] bytes = new byte[count * FeedFrameWriter.TickFrameSize];
        for (int i = 0; i < count; i++)
        {
            FeedFrameWriter.WriteTick(
                bytes.AsSpan(i * FeedFrameWriter.TickFrameSize), Tick((ulong)i + 1));
        }

        return bytes;
    }

    public static TheoryData<int> SplitPoints
    {
        get
        {
            TheoryData<int> data = [];
            for (int i = 1; i < FeedFrameWriter.TickFrameSize; i++)
            {
                data.Add(i);
            }

            return data;
        }
    }

    /// <summary>
    /// A frame arrives in whatever pieces the network hands over. Truncation must read as "need
    /// more data" and must leave the caller's position untouched, or a pipeline reader will
    /// consume bytes it has not decoded.
    /// </summary>
    [Theory]
    [MemberData(nameof(SplitPoints))]
    public void PartialFrameNeedsMoreDataAndLeavesTheBufferUntouched(int availableBytes)
    {
        byte[] frame = EncodeTicks(1);
        var buffer = new ReadOnlySequence<byte>(frame, 0, availableBytes);
        ReadOnlySequence<byte> original = buffer;

        bool read = FeedFrameReader.TryReadFrame(ref buffer, out _, out _);

        read.ShouldBeFalse();
        buffer.Length.ShouldBe(original.Length);
        buffer.ToArray().ShouldBe(original.ToArray());
    }

    [Theory]
    [MemberData(nameof(SplitPoints))]
    public void CompleteFrameDecodesNoMatterWhereTheSegmentBoundaryFalls(int splitAt)
    {
        byte[] frame = EncodeTicks(1);
        ReadOnlySequence<byte> buffer = Segmented(frame, splitAt);

        bool read = FeedFrameReader.TryReadFrame(ref buffer, out FeedMessageType type, out ReadOnlySequence<byte> payload);

        read.ShouldBeTrue();
        type.ShouldBe(FeedMessageType.Trade);
        payload.Length.ShouldBe(FeedFrameWriter.TickPayloadSize);
        buffer.Length.ShouldBe(0);

        FeedRecord decoded = FeedFrameReader.ReadTick(payload);
        decoded.ShouldBe(Tick(1));
    }

    [Fact]
    public void ReadsWholeFramesAndLeavesThePartialOneInPlace()
    {
        byte[] two = EncodeTicks(2);
        int halfFrame = FeedFrameWriter.TickFrameSize / 2;
        byte[] twoAndAHalf = new byte[two.Length + halfFrame];
        two.CopyTo(twoAndAHalf, 0);
        EncodeTicks(1).AsSpan(0, halfFrame).CopyTo(twoAndAHalf.AsSpan(two.Length));

        var buffer = new ReadOnlySequence<byte>(twoAndAHalf);

        FeedFrameReader.TryReadFrame(ref buffer, out _, out ReadOnlySequence<byte> first).ShouldBeTrue();
        FeedFrameReader.ReadTick(first).SequenceNumber.ShouldBe(1UL);

        FeedFrameReader.TryReadFrame(ref buffer, out _, out ReadOnlySequence<byte> second).ShouldBeTrue();
        FeedFrameReader.ReadTick(second).SequenceNumber.ShouldBe(2UL);

        ReadOnlySequence<byte> beforeThirdAttempt = buffer;
        FeedFrameReader.TryReadFrame(ref buffer, out _, out _).ShouldBeFalse();

        buffer.Length.ShouldBe(halfFrame);
        buffer.ToArray().ShouldBe(beforeThirdAttempt.ToArray());
    }

    [Fact]
    public void HeartbeatAndSessionStartAreClassifiedByTheirLengthPrefix()
    {
        byte[] bytes = new byte[FeedFrameWriter.SessionStartFrameSize + FeedFrameWriter.HeartbeatFrameSize];
        var sessionId = Guid.NewGuid();
        FeedFrameWriter.WriteSessionStart(bytes, sessionId, 1000, SampleNanos);
        FeedFrameWriter.WriteHeartbeat(
            bytes.AsSpan(FeedFrameWriter.SessionStartFrameSize), 42, SampleNanos);

        var buffer = new ReadOnlySequence<byte>(bytes);

        FeedFrameReader.TryReadFrame(ref buffer, out FeedMessageType first, out ReadOnlySequence<byte> startPayload).ShouldBeTrue();
        first.ShouldBe(FeedMessageType.SessionStart);
        FeedFrameReader.ReadSessionStart(startPayload.FirstSpan, out Guid decodedId, out uint hb, out _);
        decodedId.ShouldBe(sessionId);
        hb.ShouldBe(1000U);

        FeedFrameReader.TryReadFrame(ref buffer, out FeedMessageType second, out ReadOnlySequence<byte> beatPayload).ShouldBeTrue();
        second.ShouldBe(FeedMessageType.Heartbeat);
        FeedFrameReader.ReadHeartbeat(beatPayload.FirstSpan, out ulong lastSeq, out _);
        lastSeq.ShouldBe(42UL);

        buffer.Length.ShouldBe(0);
    }

    [Theory]
    [InlineData(1025)]
    [InlineData(int.MaxValue)]
    [InlineData(uint.MaxValue)]
    public void RejectsAnOversizedDeclaredLength(long declared)
    {
        byte[] bytes = new byte[FeedFrameWriter.LengthPrefixSize];
        BinaryPrimitives.WriteUInt32LittleEndian(bytes, (uint)declared);

        Should.Throw<InvalidDataException>(() =>
        {
            var buffer = new ReadOnlySequence<byte>(bytes);
            FeedFrameReader.TryReadFrame(ref buffer, out _, out _);
        });
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    public void RejectsAPayloadTooSmallToClassify(uint declared)
    {
        byte[] bytes = new byte[FeedFrameWriter.LengthPrefixSize + 2];
        BinaryPrimitives.WriteUInt32LittleEndian(bytes, declared);

        Should.Throw<InvalidDataException>(() =>
        {
            var buffer = new ReadOnlySequence<byte>(bytes);
            FeedFrameReader.TryReadFrame(ref buffer, out _, out _);
        });
    }

    [Fact]
    public void RejectsAnUnsupportedWireVersion()
    {
        byte[] frame = EncodeTicks(1);
        frame[FeedFrameWriter.LengthPrefixSize] = 2;

        Should.Throw<InvalidDataException>(() =>
        {
            var buffer = new ReadOnlySequence<byte>(frame);
            FeedFrameReader.TryReadFrame(ref buffer, out _, out _);
        });
    }

    [Fact]
    public void RejectsAnUnknownMessageType()
    {
        byte[] frame = EncodeTicks(1);
        frame[FeedFrameWriter.LengthPrefixSize + 1] = 99;

        Should.Throw<InvalidDataException>(() =>
        {
            var buffer = new ReadOnlySequence<byte>(frame);
            FeedFrameReader.TryReadFrame(ref buffer, out _, out _);
        });
    }

    /// <summary>
    /// A length that is legal in the abstract but wrong for the declared type still means the
    /// sender and this reader disagree about the layout, which is a framing error.
    /// </summary>
    [Fact]
    public void RejectsALengthThatDisagreesWithTheDeclaredType()
    {
        byte[] frame = new byte[FeedFrameWriter.LengthPrefixSize + 24];
        BinaryPrimitives.WriteUInt32LittleEndian(frame, 24);
        frame[FeedFrameWriter.LengthPrefixSize] = 1;
        frame[FeedFrameWriter.LengthPrefixSize + 1] = (byte)FeedMessageType.Trade;

        Should.Throw<InvalidDataException>(() =>
        {
            var buffer = new ReadOnlySequence<byte>(frame);
            FeedFrameReader.TryReadFrame(ref buffer, out _, out _);
        });
    }

    [Fact]
    public void DecodesATickThatStraddlesSegmentsWithoutAllocating()
    {
        byte[] frame = EncodeTicks(1);
        ReadOnlySequence<byte> buffer = Segmented(frame, 20);
        FeedFrameReader.TryReadFrame(ref buffer, out _, out ReadOnlySequence<byte> payload);

        payload.IsSingleSegment.ShouldBeFalse();

        for (int i = 0; i < 128; i++)
        {
            _ = FeedFrameReader.ReadTick(payload);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 10_000; i++)
        {
            _ = FeedFrameReader.ReadTick(payload);
        }

        (GC.GetAllocatedBytesForCurrentThread() - before).ShouldBe(0);
    }

    private static ReadOnlySequence<byte> Segmented(byte[] data, int splitAt)
    {
        var first = new Segment(data.AsMemory(0, splitAt));
        Segment last = first.Append(data.AsMemory(splitAt));
        return new ReadOnlySequence<byte>(first, 0, last, last.Memory.Length);
    }

    private sealed class Segment : ReadOnlySequenceSegment<byte>
    {
        internal Segment(ReadOnlyMemory<byte> memory) => Memory = memory;

        internal Segment Append(ReadOnlyMemory<byte> memory)
        {
            var next = new Segment(memory) { RunningIndex = RunningIndex + Memory.Length };
            Next = next;
            return next;
        }
    }
}
