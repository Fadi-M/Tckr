using Tckr.MockExchange.Protocol;

namespace Tckr.MockExchange.Generation;

/// <summary>
/// Produces the exchange's tape: an ordered, reproducible stream of trades and top-of-book quotes.
/// </summary>
/// <remarks>
/// <para>
/// The unit of work is a caller-owned <see cref="Span{T}"/>, not an event and not an
/// <see cref="IEnumerable{T}"/>. Both alternatives put an allocation, an interface dispatch or a
/// state machine on a path that runs 25,000 times a second; filling a buffer the publisher already
/// owns puts none of them there and lets task 06 size the batch from whatever the rate governor
/// says is owed.
/// </para>
/// <para>
/// <b>Sequence numbers are deliberately not set here.</b> Implementations leave
/// <c>FeedRecord.SequenceNumber</c> at zero and the feed session (task 05) stamps it at publish
/// time. The reason is that a sequence number is a property of a <em>connection</em>, not of the
/// tape: it counts the records a given session was <em>offered</em>, so a consumer can tell
/// exactly how much it lost when a record is withheld under backpressure. One generation loop
/// feeds every connected session, and sessions connect and disconnect at different points in the
/// tape, so a number assigned here would either be shared &#8212; making a late joiner's feed start
/// at some arbitrary large value with no way to detect loss before it connected &#8212; or would
/// have to be rewritten per session anyway. Assigning it once, at the only place that knows which
/// connection a record is going to, is the whole of it.
/// </para>
/// <para>
/// Implementations are not thread-safe: one generator drives one generation loop.
/// </para>
/// </remarks>
internal interface IMarketDataGenerator
{
    /// <summary>
    /// Fills <paramref name="destination"/> completely with the next records of the tape.
    /// </summary>
    /// <remarks>
    /// Every element is written; there is no partial fill and no return count, because the
    /// generator is never short of events to produce. Allocates nothing.
    /// </remarks>
    /// <param name="destination">Buffer to fill. An empty span is a no-op.</param>
    void Generate(Span<FeedRecord> destination);

    /// <summary>
    /// Opens a new trading session: re-anchors every symbol's reference price and band, and clears
    /// the per-session counters.
    /// </summary>
    /// <remarks>
    /// Re-anchoring moves each symbol's anchor to where its price currently is, the way a venue's
    /// reference price for the day is the previous session's close. Snapping back to the original
    /// reference-data price instead would yank every instrument across the tape in one event after
    /// a long session, which is a discontinuity nothing downstream should have to explain. The
    /// consequence, and it is intended, is that the daily band is relative to each session's open,
    /// so a price may drift further than one band's width over many sessions.
    /// <para>
    /// The timestamp clock is <em>not</em> restarted. Timestamps are required to be non-decreasing
    /// across the whole stream, and a session boundary is not a licence to break that.
    /// </para>
    /// </remarks>
    void ResetSession();
}
