using System.Buffers.Binary;
using System.Text;

namespace Tckr.MockExchange.Protocol;

/// <summary>
/// A ticker symbol in its wire form: exactly eight bytes, right-padded with spaces.
/// </summary>
/// <remarks>
/// Stored as a single packed <see cref="ulong"/> holding wire bytes 0&#8211;7 in little-endian
/// order, so the value is byte-for-byte the wire layout and writing it is one store. The point is
/// that the generation loop can carry a symbol around inside a struct without touching the heap:
/// a <see cref="string"/> here would put an allocation and a pointer chase on a path that runs
/// 25,000 times a second. Comparison and hashing are a single integer operation, which also makes
/// this cheap as a dictionary key for the per-symbol state in Phase 2 task 03.
/// </remarks>
internal readonly struct Symbol8 : IEquatable<Symbol8>
{
    /// <summary>Bytes a symbol occupies on the wire.</summary>
    internal const int Length = 8;

    /// <summary>Byte used to right-pad symbols shorter than <see cref="Length"/>.</summary>
    internal const byte Padding = (byte)' ';

    private const byte FirstPrintable = 0x21; // '!' - excludes the space used as padding
    private const byte LastPrintable = 0x7E;  // '~'

    private readonly ulong _packed;

    private Symbol8(ulong packed) => _packed = packed;

    /// <summary>
    /// Builds a symbol from text, padding to <see cref="Length"/> bytes.
    /// </summary>
    /// <remarks>
    /// Any printable non-space ASCII character is accepted rather than A&#8211;Z only: real
    /// tickers carry digits and separators (<c>BRK.B</c>), and the codec is the wrong layer to
    /// decide what a venue may list. Case and listing rules are the symbol universe's business
    /// (task 02); framing correctness is this type's.
    /// </remarks>
    /// <exception cref="ArgumentException">
    /// The text is empty, longer than <see cref="Length"/>, or contains a space or a
    /// non-printable / non-ASCII character &#8212; any of which would decode ambiguously.
    /// </exception>
    internal static Symbol8 FromAscii(ReadOnlySpan<char> symbol)
    {
        if (symbol.Length is 0 or > Length)
        {
            throw new ArgumentException(
                $"Symbol must be 1 to {Length} characters; got {symbol.Length}.", nameof(symbol));
        }

        Span<byte> bytes = stackalloc byte[Length];
        bytes.Fill(Padding);

        for (int i = 0; i < symbol.Length; i++)
        {
            char c = symbol[i];
            if (c is < (char)FirstPrintable or > (char)LastPrintable)
            {
                throw new ArgumentException(
                    $"Symbol '{symbol}' has a space or non-printable ASCII character at index {i}.",
                    nameof(symbol));
            }

            bytes[i] = (byte)c;
        }

        return new Symbol8(BinaryPrimitives.ReadUInt64LittleEndian(bytes));
    }

    /// <summary>
    /// Reads a symbol out of a frame payload, validating the padding rule.
    /// </summary>
    /// <exception cref="InvalidDataException">
    /// The field is empty, holds an embedded space, or holds a non-printable byte. An embedded
    /// space is rejected rather than trimmed because the two readings of <c>"AB CD   "</c> pick
    /// different instruments, and silently choosing one corrupts the tape.
    /// </exception>
    internal static Symbol8 FromWire(ReadOnlySpan<byte> source)
    {
        if (source.Length != Length)
        {
            throw new ArgumentException(
                $"Symbol field is {Length} bytes; got {source.Length}.", nameof(source));
        }

        int end = source.IndexOf(Padding);
        if (end < 0)
        {
            end = Length;
        }

        if (end == 0)
        {
            throw new InvalidDataException("Frame carries an empty symbol.");
        }

        for (int i = 0; i < end; i++)
        {
            if (source[i] is < FirstPrintable or > LastPrintable)
            {
                throw new InvalidDataException(
                    $"Symbol byte 0x{source[i]:X2} at index {i} is not printable ASCII.");
            }
        }

        for (int i = end; i < Length; i++)
        {
            if (source[i] != Padding)
            {
                throw new InvalidDataException(
                    $"Symbol has an embedded space; byte {i} is 0x{source[i]:X2}, expected padding.");
            }
        }

        return new Symbol8(BinaryPrimitives.ReadUInt64LittleEndian(source));
    }

    /// <summary>Copies the eight wire bytes into <paramref name="destination"/>.</summary>
    internal void WriteTo(Span<byte> destination) =>
        BinaryPrimitives.WriteUInt64LittleEndian(destination, _packed);

    /// <summary>Characters before the trailing padding.</summary>
    internal int TrimmedLength
    {
        get
        {
            Span<byte> bytes = stackalloc byte[Length];
            BinaryPrimitives.WriteUInt64LittleEndian(bytes, _packed);
            int end = bytes.IndexOf(Padding);
            return end < 0 ? Length : end;
        }
    }

    /// <summary>
    /// Materialises the symbol as text. Allocates &#8212; for logs, diagnostics and tests only,
    /// never the publishing path.
    /// </summary>
    public override string ToString()
    {
        Span<byte> bytes = stackalloc byte[Length];
        BinaryPrimitives.WriteUInt64LittleEndian(bytes, _packed);
        int end = bytes.IndexOf(Padding);
        return Encoding.ASCII.GetString(bytes[..(end < 0 ? Length : end)]);
    }

    public bool Equals(Symbol8 other) => _packed == other._packed;

    public override bool Equals(object? obj) => obj is Symbol8 other && Equals(other);

    public override int GetHashCode() => _packed.GetHashCode();

    public static bool operator ==(Symbol8 left, Symbol8 right) => left.Equals(right);

    public static bool operator !=(Symbol8 left, Symbol8 right) => !left.Equals(right);
}

/// <summary>
/// One tick on the exchange feed &#8212; a trade print or a top-of-book quote update.
/// </summary>
/// <remarks>
/// A struct with no reference fields, so the generator can produce and the writer can encode
/// millions of these without a single allocation. The <c>Version</c> byte on the wire is not a
/// field here: only version <see cref="CurrentVersion"/> exists, and the reader rejects anything
/// else before a record is ever constructed, so carrying it would only invite code that branches
/// on a value that cannot vary.
/// </remarks>
internal readonly record struct FeedRecord
{
    /// <summary>Wire format version this build reads and writes.</summary>
    internal const byte CurrentVersion = 1;

    /// <summary>Bit 0 of <see cref="Flags"/>: the print came out of an auction, not continuous trading.</summary>
    internal const ushort AuctionPrintFlag = 0x0001;

    /// <summary>Trade, bid or ask. The session message types never appear on a record.</summary>
    internal required FeedMessageType MessageType { get; init; }

    /// <summary>Bit field; only <see cref="AuctionPrintFlag"/> is defined, the rest are reserved zero.</summary>
    internal required ushort Flags { get; init; }

    /// <summary>Shares. Always greater than zero on a well-formed tick.</summary>
    internal required uint Quantity { get; init; }

    /// <summary>
    /// Monotonic counter, per connection, starting at 1 and incremented by ticks only &#8212;
    /// heartbeats and the session-start frame do not consume one.
    /// </summary>
    /// <remarks>
    /// A gap is data loss, never reordering: the counter is consumed by every record the session
    /// is <em>offered</em>, so a record withheld under backpressure burns its number and the gap
    /// is exactly the size of the loss. Under the default <c>Disconnect</c> policy a gap should
    /// never be observed at all, because a session that withholds anything is closed; under
    /// <c>DropOldest</c> a gap is the exchange disclosing what it dropped, and the session
    /// continues. Phase 3 derives its <c>eventId</c> from the pair (session id, sequence number),
    /// which is why the counter is per session: reusing it globally would make that identity
    /// collide across reconnects.
    /// </remarks>
    internal required ulong SequenceNumber { get; init; }

    /// <summary>Exchange-side event time, Unix epoch nanoseconds, UTC.</summary>
    internal required long ExchangeTimestampNanos { get; init; }

    /// <summary>Price in fixed point; see <see cref="PriceScale"/>.</summary>
    internal required long PriceScaled { get; init; }

    /// <summary>The instrument.</summary>
    internal required Symbol8 Symbol { get; init; }

    /// <summary>Whether <see cref="AuctionPrintFlag"/> is set.</summary>
    internal bool IsAuctionPrint => (Flags & AuctionPrintFlag) != 0;

    /// <summary>Price as a decimal. Convenience for logs and tests, not the hot path.</summary>
    internal decimal Price => PriceScale.FromScaled(PriceScaled);

    /// <summary>
    /// The symbol as text. Allocates &#8212; for logs, diagnostics and tests only.
    /// </summary>
    internal string SymbolAsString() => Symbol.ToString();
}
