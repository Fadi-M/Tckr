namespace Tckr.MockExchange.Feed;

/// <summary>
/// Settings for <see cref="FeedServer"/> and the sessions it accepts.
/// </summary>
/// <remarks>
/// TODO(task-06): this type belongs in <c>Tckr.MockExchange.Options</c> and is owned by task 06,
/// which also binds it to configuration and validates it on startup. It lives here as a plain
/// placeholder so task 05 could be built and tested ahead of the configuration task. When task 06
/// creates <c>Options/FeedServerOptions.cs</c>, delete this file: the type name, the property
/// names and the defaults are reproduced verbatim in task 05's brief, so the move costs
/// <see cref="FeedServer"/> one <c>using</c> and nothing else.
/// <para>
/// Deliberately a POCO with no validation: <see cref="FeedServer"/>'s constructor validates what
/// it needs, so task 06 can bind this straight from configuration and add its own
/// <c>ValidateOnStart</c> rules without duplicating logic that already exists.
/// </para>
/// </remarks>
internal sealed class FeedServerOptions
{
    /// <summary>Interface to bind. <c>0.0.0.0</c> for every interface, <c>127.0.0.1</c> for local only.</summary>
    internal string ListenAddress { get; set; } = "0.0.0.0";

    /// <summary>TCP port to listen on. <c>0</c> binds an ephemeral port &#8212; used by the tests.</summary>
    internal int Port { get; set; } = 5001;

    /// <summary>
    /// Concurrent sessions accepted. Beyond this a connection is accepted and closed immediately
    /// rather than left queued, so a rejected consumer finds out at once.
    /// </summary>
    internal int MaxSessions { get; set; } = 8;

    /// <summary>
    /// Bytes of outbound buffer per session before the session is considered behind. At the
    /// Phase 2 target of 25,000 ticks/sec this is roughly 3.5 seconds of tape.
    /// </summary>
    internal int SessionBufferBytes { get; set; } = 4 * 1024 * 1024;

    /// <summary>
    /// How long a session that has filled its buffer is given to drain before
    /// <see cref="SlowConsumerPolicy"/> is applied.
    /// </summary>
    internal int SlowConsumerTimeoutMs { get; set; } = 2000;

    /// <summary>What to do with a session that is still behind after <see cref="SlowConsumerTimeoutMs"/>.</summary>
    internal SlowConsumerPolicy SlowConsumerPolicy { get; set; } = SlowConsumerPolicy.Disconnect;

    /// <summary>
    /// Idle gap after which a heartbeat is emitted, so a consumer can tell a quiet market from a
    /// dead socket. Also the value advertised in the session-start frame.
    /// </summary>
    internal int HeartbeatIntervalMs { get; set; } = 1000;

    /// <summary>Socket send buffer per session.</summary>
    internal int SendBufferSize { get; set; } = 256 * 1024;

    /// <summary>Bound on how long graceful shutdown waits for sessions to flush.</summary>
    internal int ShutdownTimeoutMs { get; set; } = 2000;
}
