namespace Tckr.MockExchange.Feed;

/// <summary>
/// What the exchange does with a session whose outbound buffer has filled.
/// </summary>
/// <remarks>
/// The exchange never blocks on a consumer, so once a session's bounded buffer is full there are
/// only two honest options: stop sending to it, or throw data away. This enum picks which.
/// <para>
/// Both options are <em>visible</em> to the consumer, which is the property that makes the choice
/// a preference rather than a correctness question. A session's sequence numbers are consumed by
/// every record the session is <em>offered</em>, not by every record it is sent, so anything the
/// exchange withholds or discards leaves a gap exactly the size of what was lost.
/// </para>
/// </remarks>
internal enum SlowConsumerPolicy
{
    /// <summary>
    /// Close the connection. The default: this feed's contract is a complete tape or none at all.
    /// </summary>
    /// <remarks>
    /// Most consumers of a sequenced market feed want completeness, and would rather reconnect and
    /// resynchronise than reason about which records they are missing. Under this policy a session
    /// that falls behind is closed &#8212; whether it drains eventually or not &#8212; the moment
    /// anything has been withheld from it. The consumer reconnects and starts a fresh session at
    /// sequence 1, which is unambiguous and needs no recovery logic beyond "reconnect".
    /// </remarks>
    Disconnect = 0,

    /// <summary>
    /// Discard the oldest undelivered bytes to make room for current data, and keep the session.
    /// </summary>
    /// <remarks>
    /// For consumers that would rather have current data with holes than a disconnection: the
    /// Phase 11 coalescing experiments, where "the newest quote for a symbol" is worth more than
    /// "every quote in order". The contract here is the opposite of
    /// <see cref="Disconnect"/>'s &#8212; you may lose records, and you will see precisely which
    /// ones, because the discarded records keep the sequence numbers they were assigned. Every
    /// drop is logged and counted.
    /// </remarks>
    DropOldest = 1,
}
