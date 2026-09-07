namespace Tckr.MockExchange.Feed;

/// <summary>
/// The session-lifecycle events the feed server counts.
/// </summary>
/// <remarks>
/// TODO(task-07): the real implementation is <c>Diagnostics/FeedMetrics</c>, owned by task 07.
/// This interface exists so task 05 could be written and tested against a contract rather than
/// against a type it does not own; the exact signatures are reproduced in task 05's brief for
/// task 07 to implement. Task 07 may implement this interface on <c>FeedMetrics</c> directly, or
/// task 06 may adapt one to the other at composition time &#8212; either keeps this file honest.
/// <para>
/// Every method is off the per-event hot path. The busiest is
/// <see cref="BytesWritten"/>, called once per socket write (once per batch, not per tick), so
/// none of these need to be allocation-free at 25,000/sec.
/// </para>
/// </remarks>
internal interface IFeedServerMetrics
{
    /// <summary>A connection was admitted and given a session.</summary>
    void SessionAccepted(Guid sessionId);

    /// <summary>A connection was refused before it became a session. <paramref name="reason"/> is a stable, low-cardinality tag.</summary>
    void SessionRejected(string reason);

    /// <summary>A session ended, for any cause. <paramref name="reason"/> is a stable, low-cardinality tag.</summary>
    void SessionClosed(Guid sessionId, string reason);

    /// <summary>A session was closed specifically because it could not keep up. Always paired with a <see cref="SessionClosed"/>.</summary>
    void SlowConsumerDisconnected(Guid sessionId);

    /// <summary>Records that were not delivered to a session because it was behind.</summary>
    void RecordsDropped(Guid sessionId, long records);

    /// <summary>Payload bytes handed to a session's socket.</summary>
    void BytesWritten(Guid sessionId, long bytes);
}

/// <summary>
/// Counts nothing. The default so <see cref="FeedServer"/> is usable, and testable, without a
/// metrics implementation wired up.
/// </summary>
internal sealed class NullFeedServerMetrics : IFeedServerMetrics
{
    internal static readonly NullFeedServerMetrics Instance = new();

    private NullFeedServerMetrics()
    {
    }

    public void SessionAccepted(Guid sessionId)
    {
    }

    public void SessionRejected(string reason)
    {
    }

    public void SessionClosed(Guid sessionId, string reason)
    {
    }

    public void SlowConsumerDisconnected(Guid sessionId)
    {
    }

    public void RecordsDropped(Guid sessionId, long records)
    {
    }

    public void BytesWritten(Guid sessionId, long bytes)
    {
    }
}
