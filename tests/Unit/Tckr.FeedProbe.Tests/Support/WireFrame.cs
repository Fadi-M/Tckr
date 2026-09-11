using System.Buffers.Binary;

namespace Tckr.FeedProbe.Tests.Support;

/// <summary>
/// Builds raw feed-frame bytes for tests, independently of <c>FeedFrameWriter</c>.
/// </summary>
/// <remarks>
/// <see cref="Tckr.FeedProbe"/>'s own codec choice (see ADR 005) is to share
/// <c>FeedFrameReader</c> rather than duplicate it, because a byte-level regression test already
/// pins the wire layout. That test lives in <c>Tckr.MockExchange.Tests</c>, an assembly this test
/// project does not have <c>InternalsVisibleTo</c> access to (nor does it need it — the probe's own
/// internals are the thing under test here). Encoding the 44/28/36-byte contract a second time, by
/// hand, from the same public wire spec documented in <c>08-feed-probe.md</c>, is exactly the
/// "genuinely independent" construction the ADR discusses and declines for production code; for a
/// test fixture that only needs to hand bytes to <c>ProbeSession.ProcessBuffer</c>, duplicating the
/// tiny layout here is simpler than trying to borrow internals across an assembly boundary this
/// project has no other reason to touch.
/// </remarks>
internal static class WireFrame
{
    internal const int LengthPrefixSize = 4;
    internal const int TickPayloadSize = 40;
    internal const int TickFrameSize = LengthPrefixSize + TickPayloadSize;
    internal const int HeartbeatPayloadSize = 24;
    internal const int HeartbeatFrameSize = LengthPrefixSize + HeartbeatPayloadSize;
    internal const int SessionStartPayloadSize = 32;
    internal const int SessionStartFrameSize = LengthPrefixSize + SessionStartPayloadSize;

    internal const byte Version = 1;
    internal const byte TradeType = 1;
    internal const byte BidQuoteType = 2;
    internal const byte AskQuoteType = 3;
    internal const byte HeartbeatType = 10;
    internal const byte SessionStartType = 11;

    internal static byte[] Tick(
        ulong sequence,
        string symbol = "COMI",
        byte messageType = TradeType,
        ushort flags = 0,
        uint quantity = 100,
        long timestampNanos = 1_700_000_000_000_000_000L,
        long priceScaled = 851_000)
    {
        byte[] frame = new byte[TickFrameSize];
        BinaryPrimitives.WriteUInt32LittleEndian(frame, TickPayloadSize);

        Span<byte> payload = frame.AsSpan(LengthPrefixSize, TickPayloadSize);
        payload[0] = Version;
        payload[1] = messageType;
        BinaryPrimitives.WriteUInt16LittleEndian(payload[2..], flags);
        BinaryPrimitives.WriteUInt32LittleEndian(payload[4..], quantity);
        BinaryPrimitives.WriteUInt64LittleEndian(payload[8..], sequence);
        BinaryPrimitives.WriteInt64LittleEndian(payload[16..], timestampNanos);
        BinaryPrimitives.WriteInt64LittleEndian(payload[24..], priceScaled);
        WriteSymbol(payload[32..40], symbol);

        return frame;
    }

    internal static byte[] Heartbeat(ulong lastSeq = 0, long timestampNanos = 1_700_000_000_000_000_000L)
    {
        byte[] frame = new byte[HeartbeatFrameSize];
        BinaryPrimitives.WriteUInt32LittleEndian(frame, HeartbeatPayloadSize);

        Span<byte> payload = frame.AsSpan(LengthPrefixSize, HeartbeatPayloadSize);
        payload[0] = Version;
        payload[1] = HeartbeatType;
        BinaryPrimitives.WriteUInt16LittleEndian(payload[2..], 0);
        BinaryPrimitives.WriteUInt32LittleEndian(payload[4..], 0);
        BinaryPrimitives.WriteUInt64LittleEndian(payload[8..], lastSeq);
        BinaryPrimitives.WriteInt64LittleEndian(payload[16..], timestampNanos);

        return frame;
    }

    internal static byte[] SessionStart(Guid sessionId, uint heartbeatMs = 1000, long startNanos = 1_700_000_000_000_000_000L)
    {
        byte[] frame = new byte[SessionStartFrameSize];
        BinaryPrimitives.WriteUInt32LittleEndian(frame, SessionStartPayloadSize);

        Span<byte> payload = frame.AsSpan(LengthPrefixSize, SessionStartPayloadSize);
        payload[0] = Version;
        payload[1] = SessionStartType;
        BinaryPrimitives.WriteUInt16LittleEndian(payload[2..], 0);
        BinaryPrimitives.WriteUInt32LittleEndian(payload[4..], heartbeatMs);
        sessionId.TryWriteBytes(payload.Slice(8, 16), bigEndian: true, out _);
        BinaryPrimitives.WriteInt64LittleEndian(payload[24..], startNanos);

        return frame;
    }

    /// <summary>Concatenates several encoded frames into one contiguous byte array.</summary>
    internal static byte[] Concat(params byte[][] frames)
    {
        int total = 0;
        foreach (byte[] f in frames)
        {
            total += f.Length;
        }

        byte[] result = new byte[total];
        int offset = 0;
        foreach (byte[] f in frames)
        {
            f.CopyTo(result, offset);
            offset += f.Length;
        }

        return result;
    }

    private static void WriteSymbol(Span<byte> destination, string symbol)
    {
        destination.Fill((byte)' ');
        for (int i = 0; i < symbol.Length && i < destination.Length; i++)
        {
            destination[i] = (byte)symbol[i];
        }
    }
}
