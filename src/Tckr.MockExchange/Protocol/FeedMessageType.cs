namespace Tckr.MockExchange.Protocol;

/// <summary>
/// Discriminates the payloads carried by the exchange feed.
/// </summary>
/// <remarks>
/// The values are explicit and permanent: they are a wire contract, not an implementation
/// detail, and Phase 3's ingestion parser is written against these exact numbers. The gap
/// between the tick types (1&#8211;3) and the session types (10&#8211;11) leaves room for
/// further tick kinds without renumbering anything a consumer already understands.
/// </remarks>
internal enum FeedMessageType : byte
{
    /// <summary>An executed trade print.</summary>
    Trade = 1,

    /// <summary>A top-of-book bid update.</summary>
    BidQuote = 2,

    /// <summary>A top-of-book ask update.</summary>
    AskQuote = 3,

    /// <summary>Liveness beat, so a consumer can tell a quiet market from a dead socket.</summary>
    Heartbeat = 10,

    /// <summary>First frame on every accepted connection; carries the session identity.</summary>
    SessionStart = 11,
}
