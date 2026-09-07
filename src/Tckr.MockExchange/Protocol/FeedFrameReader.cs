using System.Buffers;
using System.Buffers.Binary;

namespace Tckr.MockExchange.Protocol;

/// <summary>
/// Decodes the exchange feed: frame extraction plus payload readers.
/// </summary>
/// <remarks>
/// This is the reference implementation of the protocol's consuming half. The verification probe
/// (task 08) uses it directly, and Phase 3's ingestion parser is a port of it, so the validation
/// rules here define what "a protocol error" means for the whole system.
/// <para>
/// Every rejection throws <see cref="InvalidDataException"/> rather than returning a sentinel. A
/// framing error means the reader no longer knows where the next frame begins, so the only sound
/// recovery is to drop the connection and resynchronise &#8212; there is nothing for a caller to
/// do with a "false" that means "corrupt" other than what it would do with an exception, and
/// conflating it with the "false" that means "need more data" is how silent corruption starts.
/// </para>
/// </remarks>
internal static class FeedFrameReader
{
    /// <summary>
    /// Largest payload accepted. Bounded so a corrupt or hostile length prefix cannot make a
    /// consumer wait on &#8212; or reserve &#8212; gigabytes that will never arrive.
    /// </summary>
    internal const int MaxPayloadSize = 1024;

    /// <summary>Smallest payload that can be classified at all: version plus message type.</summary>
    internal const int MinPayloadSize = 2;

    /// <summary>
    /// Extracts the next complete frame from <paramref name="buffer"/>.
    /// </summary>
    /// <param name="buffer">
    /// Advanced past the frame on success; left exactly as it was on failure. Frames straddle
    /// segment boundaries when they arrive from a <c>System.IO.Pipelines</c> reader, which is why
    /// this takes a sequence rather than a span.
    /// </param>
    /// <param name="type">The decoded message type, on success.</param>
    /// <param name="payload">The payload, excluding the length prefix, on success.</param>
    /// <returns>
    /// <see langword="true"/> when a whole frame was read; <see langword="false"/> when more data
    /// is needed. False never means "corrupt" &#8212; that throws.
    /// </returns>
    /// <exception cref="InvalidDataException">
    /// The declared length is out of range, the version is unsupported, the message type is
    /// unknown, or the declared length disagrees with that type's fixed layout.
    /// </exception>
    internal static bool TryReadFrame(
        ref ReadOnlySequence<byte> buffer,
        out FeedMessageType type,
        out ReadOnlySequence<byte> payload)
    {
        type = default;
        payload = default;

        if (buffer.Length < FeedFrameWriter.LengthPrefixSize)
        {
            return false;
        }

        Span<byte> prefix = stackalloc byte[FeedFrameWriter.LengthPrefixSize];
        buffer.Slice(0, FeedFrameWriter.LengthPrefixSize).CopyTo(prefix);
        uint declared = BinaryPrimitives.ReadUInt32LittleEndian(prefix);

        if (declared is < MinPayloadSize or > MaxPayloadSize)
        {
            throw new InvalidDataException(
                $"Frame declares a {declared}-byte payload; the protocol allows " +
                $"{MinPayloadSize} to {MaxPayloadSize}.");
        }

        if (buffer.Length < FeedFrameWriter.LengthPrefixSize + declared)
        {
            return false;
        }

        ReadOnlySequence<byte> candidate = buffer.Slice(FeedFrameWriter.LengthPrefixSize, declared);

        Span<byte> header = stackalloc byte[MinPayloadSize];
        candidate.Slice(0, MinPayloadSize).CopyTo(header);

        if (header[0] != FeedRecord.CurrentVersion)
        {
            throw new InvalidDataException(
                $"Frame declares wire version {header[0]}; this build speaks version " +
                $"{FeedRecord.CurrentVersion}.");
        }

        var declaredType = (FeedMessageType)header[1];
        int expected = ExpectedPayloadSize(declaredType);

        if (declared != expected)
        {
            throw new InvalidDataException(
                $"{declaredType} frame declares {declared} payload bytes; its layout is " +
                $"{expected} bytes.");
        }

        type = declaredType;
        payload = candidate;
        buffer = buffer.Slice(FeedFrameWriter.LengthPrefixSize + declared);
        return true;
    }

    /// <summary>Decodes a tick payload.</summary>
    /// <exception cref="InvalidDataException">The payload is malformed.</exception>
    internal static FeedRecord ReadTick(ReadOnlySpan<byte> payload)
    {
        if (payload.Length != FeedFrameWriter.TickPayloadSize)
        {
            throw new InvalidDataException(
                $"Tick payload is {FeedFrameWriter.TickPayloadSize} bytes; got {payload.Length}.");
        }

        if (payload[0] != FeedRecord.CurrentVersion)
        {
            throw new InvalidDataException(
                $"Tick declares wire version {payload[0]}; this build speaks version " +
                $"{FeedRecord.CurrentVersion}.");
        }

        var type = (FeedMessageType)payload[1];
        if (type is not (FeedMessageType.Trade
            or FeedMessageType.BidQuote
            or FeedMessageType.AskQuote))
        {
            throw new InvalidDataException($"Message type {payload[1]} is not a tick.");
        }

        return new FeedRecord
        {
            MessageType = type,
            Flags = BinaryPrimitives.ReadUInt16LittleEndian(payload[2..]),
            Quantity = BinaryPrimitives.ReadUInt32LittleEndian(payload[4..]),
            SequenceNumber = BinaryPrimitives.ReadUInt64LittleEndian(payload[8..]),
            ExchangeTimestampNanos = BinaryPrimitives.ReadInt64LittleEndian(payload[16..]),
            PriceScaled = BinaryPrimitives.ReadInt64LittleEndian(payload[24..]),
            Symbol = Symbol8.FromWire(payload.Slice(32, Symbol8.Length)),
        };
    }

    /// <summary>
    /// Decodes a tick payload that may straddle segment boundaries. Copies to the stack in the
    /// split case, so it stays allocation-free either way.
    /// </summary>
    /// <exception cref="InvalidDataException">The payload is malformed.</exception>
    internal static FeedRecord ReadTick(in ReadOnlySequence<byte> payload)
    {
        if (payload.IsSingleSegment)
        {
            return ReadTick(payload.FirstSpan);
        }

        if (payload.Length != FeedFrameWriter.TickPayloadSize)
        {
            throw new InvalidDataException(
                $"Tick payload is {FeedFrameWriter.TickPayloadSize} bytes; got {payload.Length}.");
        }

        Span<byte> contiguous = stackalloc byte[FeedFrameWriter.TickPayloadSize];
        payload.CopyTo(contiguous);
        return ReadTick(contiguous);
    }

    /// <summary>Decodes a heartbeat payload.</summary>
    /// <exception cref="InvalidDataException">The payload is malformed.</exception>
    internal static void ReadHeartbeat(
        ReadOnlySpan<byte> payload, out ulong lastSequenceNumber, out long timestampNanos)
    {
        EnsureHeader(payload, FeedMessageType.Heartbeat, FeedFrameWriter.HeartbeatPayloadSize);

        lastSequenceNumber = BinaryPrimitives.ReadUInt64LittleEndian(payload[8..]);
        timestampNanos = BinaryPrimitives.ReadInt64LittleEndian(payload[16..]);
    }

    /// <summary>Decodes a session-start payload.</summary>
    /// <exception cref="InvalidDataException">The payload is malformed.</exception>
    internal static void ReadSessionStart(
        ReadOnlySpan<byte> payload,
        out Guid sessionId,
        out uint heartbeatIntervalMs,
        out long startTimestampNanos)
    {
        EnsureHeader(payload, FeedMessageType.SessionStart, FeedFrameWriter.SessionStartPayloadSize);

        heartbeatIntervalMs = BinaryPrimitives.ReadUInt32LittleEndian(payload[4..]);
        sessionId = new Guid(payload.Slice(8, 16), bigEndian: true);
        startTimestampNanos = BinaryPrimitives.ReadInt64LittleEndian(payload[24..]);
    }

    private static void EnsureHeader(
        ReadOnlySpan<byte> payload, FeedMessageType expectedType, int expectedSize)
    {
        if (payload.Length != expectedSize)
        {
            throw new InvalidDataException(
                $"{expectedType} payload is {expectedSize} bytes; got {payload.Length}.");
        }

        if (payload[0] != FeedRecord.CurrentVersion)
        {
            throw new InvalidDataException(
                $"Frame declares wire version {payload[0]}; this build speaks version " +
                $"{FeedRecord.CurrentVersion}.");
        }

        if ((FeedMessageType)payload[1] != expectedType)
        {
            throw new InvalidDataException(
                $"Expected a {expectedType} payload; message type byte is {payload[1]}.");
        }
    }

    private static int ExpectedPayloadSize(FeedMessageType type) => type switch
    {
        FeedMessageType.Trade
            or FeedMessageType.BidQuote
            or FeedMessageType.AskQuote => FeedFrameWriter.TickPayloadSize,
        FeedMessageType.Heartbeat => FeedFrameWriter.HeartbeatPayloadSize,
        FeedMessageType.SessionStart => FeedFrameWriter.SessionStartPayloadSize,
        _ => throw new InvalidDataException($"Unknown message type {(byte)type}."),
    };
}
