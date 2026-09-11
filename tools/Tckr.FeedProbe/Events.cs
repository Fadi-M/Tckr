namespace Tckr.FeedProbe;

/// <summary>
/// A sequence gap: the exchange did not deliver <see cref="GapSize"/> records it had reserved
/// numbers for, between <see cref="ExpectedSequence"/> and <see cref="ReceivedSequence"/>.
/// </summary>
/// <remarks>
/// See <c>05-tcp-feed-server.md</c>, "What a gap means, precisely": on this transport a decoded gap
/// is always exchange-side loss, never network loss, and it is not itself a corruption signal — it
/// is the expected disclosure under <c>DropOldest</c> and (normally) unreachable under the default
/// <c>Disconnect</c>. Whether it fails the run is <see cref="ProbeOptions.ExpectDrops"/>'s call, not
/// this type's.
/// </remarks>
internal readonly record struct GapEvent(
    ulong ExpectedSequence, ulong ReceivedSequence, ulong GapSize, DateTimeOffset ObservedAtUtc);

/// <summary>
/// A sequence number at or below one already seen on this session — reorder or duplication.
/// </summary>
/// <remarks>
/// Impossible on a single TCP session: bytes arrive in order or the connection breaks, and a
/// corrupt frame throws rather than resynchronising past it (see <see cref="FramingErrorEvent"/>).
/// Reported separately from <see cref="GapEvent"/> and always treated as a failure regardless of
/// <see cref="ProbeOptions.ExpectDrops"/>: a gap is an admitted loss, this is a protocol invariant
/// violation.
/// </remarks>
internal readonly record struct SequenceIntegrityViolation(
    ulong ExpectedSequence, ulong ReceivedSequence, DateTimeOffset ObservedAtUtc);

/// <summary>A frame the reader rejected outright — malformed length prefix, bad version, unknown type, or bad symbol padding.</summary>
internal readonly record struct FramingErrorEvent(string Message, DateTimeOffset ObservedAtUtc);

/// <summary><c>--verify-order</c> only: a symbol's exchange timestamp went backwards between two consecutive ticks.</summary>
internal readonly record struct OrderViolationEvent(
    string Symbol, ulong SequenceNumber, long PreviousTimestampNanos, long ObservedTimestampNanos);
