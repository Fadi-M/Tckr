using System.Buffers.Binary;

namespace Tckr.MockExchange.Protocol;

/// <summary>
/// Encodes feed messages into a caller-supplied buffer.
/// </summary>
/// <remarks>
/// Every method writes into a <see cref="Span{T}"/> the caller owns &#8212; no
/// <c>MemoryStream</c>, no <c>BinaryWriter</c>, no return-a-new-array. At 25,000 events per
/// second an allocation per record is roughly a megabyte a second of pure garbage, and the
/// resulting collections land in the middle of the latency measurements that Phase 4 onward
/// exists to take. The publisher packs a batch of frames into one pooled buffer and issues a
/// single write; these methods are the innermost step of that loop.
/// <para>
/// All multi-byte integers are little-endian, written through <see cref="BinaryPrimitives"/> so
/// the bytes are identical regardless of the host's endianness.
/// </para>
/// </remarks>
internal static class FeedFrameWriter
{
    /// <summary>Bytes of length prefix ahead of every payload.</summary>
    internal const int LengthPrefixSize = 4;

    /// <summary>Payload bytes in a trade or quote message.</summary>
    internal const int TickPayloadSize = 40;

    /// <summary>Payload bytes in a heartbeat message.</summary>
    internal const int HeartbeatPayloadSize = 24;

    /// <summary>Payload bytes in a session-start message.</summary>
    internal const int SessionStartPayloadSize = 32;

    /// <summary>Total wire bytes of a tick frame, prefix included.</summary>
    internal const int TickFrameSize = LengthPrefixSize + TickPayloadSize;

    /// <summary>Total wire bytes of a heartbeat frame, prefix included.</summary>
    internal const int HeartbeatFrameSize = LengthPrefixSize + HeartbeatPayloadSize;

    /// <summary>Total wire bytes of a session-start frame, prefix included.</summary>
    internal const int SessionStartFrameSize = LengthPrefixSize + SessionStartPayloadSize;

    /// <summary>
    /// Writes <paramref name="record"/> as a framed tick message.
    /// </summary>
    /// <returns>Bytes written, always <see cref="TickFrameSize"/>.</returns>
    /// <exception cref="ArgumentException">
    /// The destination is too small, or the record is not a tick.
    /// </exception>
    internal static int WriteTick(Span<byte> destination, in FeedRecord record)
    {
        EnsureCapacity(destination, TickFrameSize);

        if (record.MessageType is not (FeedMessageType.Trade
            or FeedMessageType.BidQuote
            or FeedMessageType.AskQuote))
        {
            throw new ArgumentException(
                $"{record.MessageType} is not a tick message type.", nameof(record));
        }

        BinaryPrimitives.WriteUInt32LittleEndian(destination, TickPayloadSize);

        Span<byte> payload = destination.Slice(LengthPrefixSize, TickPayloadSize);
        payload[0] = FeedRecord.CurrentVersion;
        payload[1] = (byte)record.MessageType;
        BinaryPrimitives.WriteUInt16LittleEndian(payload[2..], record.Flags);
        BinaryPrimitives.WriteUInt32LittleEndian(payload[4..], record.Quantity);
        BinaryPrimitives.WriteUInt64LittleEndian(payload[8..], record.SequenceNumber);
        BinaryPrimitives.WriteInt64LittleEndian(payload[16..], record.ExchangeTimestampNanos);
        BinaryPrimitives.WriteInt64LittleEndian(payload[24..], record.PriceScaled);
        record.Symbol.WriteTo(payload[32..]);

        return TickFrameSize;
    }

    /// <summary>
    /// Writes a heartbeat frame.
    /// </summary>
    /// <param name="lastSeq">
    /// Sequence number of the last tick sent on this session, or 0 if none has been. It lets a
    /// consumer confirm across a silent stretch that it missed nothing.
    /// </param>
    /// <returns>Bytes written, always <see cref="HeartbeatFrameSize"/>.</returns>
    /// <exception cref="ArgumentException">The destination is too small.</exception>
    internal static int WriteHeartbeat(Span<byte> destination, ulong lastSeq, long timestampNanos)
    {
        EnsureCapacity(destination, HeartbeatFrameSize);

        BinaryPrimitives.WriteUInt32LittleEndian(destination, HeartbeatPayloadSize);

        Span<byte> payload = destination.Slice(LengthPrefixSize, HeartbeatPayloadSize);
        payload[0] = FeedRecord.CurrentVersion;
        payload[1] = (byte)FeedMessageType.Heartbeat;
        BinaryPrimitives.WriteUInt16LittleEndian(payload[2..], 0);
        BinaryPrimitives.WriteUInt32LittleEndian(payload[4..], 0);
        BinaryPrimitives.WriteUInt64LittleEndian(payload[8..], lastSeq);
        BinaryPrimitives.WriteInt64LittleEndian(payload[16..], timestampNanos);

        return HeartbeatFrameSize;
    }

    /// <summary>
    /// Writes the session-start frame that opens every accepted connection.
    /// </summary>
    /// <returns>Bytes written, always <see cref="SessionStartFrameSize"/>.</returns>
    /// <exception cref="ArgumentException">The destination is too small.</exception>
    internal static int WriteSessionStart(
        Span<byte> destination, Guid sessionId, uint heartbeatMs, long startNanos)
    {
        EnsureCapacity(destination, SessionStartFrameSize);

        BinaryPrimitives.WriteUInt32LittleEndian(destination, SessionStartPayloadSize);

        Span<byte> payload = destination.Slice(LengthPrefixSize, SessionStartPayloadSize);
        payload[0] = FeedRecord.CurrentVersion;
        payload[1] = (byte)FeedMessageType.SessionStart;
        BinaryPrimitives.WriteUInt16LittleEndian(payload[2..], 0);
        BinaryPrimitives.WriteUInt32LittleEndian(payload[4..], heartbeatMs);

        // RFC 4122 byte order rather than .NET's native mixed-endian layout: the identifier
        // crosses a wire to consumers that will not all be .NET, and every one of them reads
        // a GUID big-endian.
        sessionId.TryWriteBytes(payload.Slice(8, 16), bigEndian: true, out _);

        BinaryPrimitives.WriteInt64LittleEndian(payload[24..], startNanos);

        return SessionStartFrameSize;
    }

    private static void EnsureCapacity(Span<byte> destination, int required)
    {
        if (destination.Length < required)
        {
            throw new ArgumentException(
                $"Destination needs {required} bytes; got {destination.Length}.",
                nameof(destination));
        }
    }
}
