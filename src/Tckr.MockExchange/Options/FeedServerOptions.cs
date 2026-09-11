using Tckr.MockExchange.Feed;

namespace Tckr.MockExchange.Options;

/// <summary>
/// Settings for <see cref="FeedServer"/> and the sessions it accepts.
/// </summary>
/// <remarks>
/// Handed over from task 05, which owned this file as a placeholder under <c>Feed/</c>. The type
/// name, property names and defaults are unchanged — <c>FeedServerTests</c> is written against
/// them — and the properties became <c>public</c> only so the configuration binder can see them.
/// <para>
/// Deliberately a POCO with <b>no</b> validation attributes: <see cref="FeedServer"/>'s
/// constructor already validates every field it uses and there is a test pinning that, so
/// duplicating the same bounds here would give two sources of truth that can disagree. What
/// <c>ValidateOnStart</c> adds for this section is only what the constructor cannot see —
/// nothing, today. The constructor runs during host start-up because the publisher service takes
/// the server, so a bad feed setting still fails at start-up with a message naming it.
/// </para>
/// </remarks>
internal sealed class FeedServerOptions
{
    /// <summary>Interface to bind. <c>0.0.0.0</c> for every interface, <c>127.0.0.1</c> for local only.</summary>
    public string ListenAddress { get; set; } = "0.0.0.0";

    /// <summary>TCP port to listen on. <c>0</c> binds an ephemeral port &#8212; used by the tests.</summary>
    public int Port { get; set; } = 5001;

    /// <summary>
    /// Concurrent sessions accepted. Beyond this a connection is accepted and closed immediately
    /// rather than left queued, so a rejected consumer finds out at once.
    /// </summary>
    public int MaxSessions { get; set; } = 8;

    /// <summary>
    /// Bytes of outbound buffer per session before the session is considered behind. At the
    /// Phase 2 target of 25,000 ticks/sec this is roughly 3.5 seconds of tape.
    /// </summary>
    public int SessionBufferBytes { get; set; } = 4 * 1024 * 1024;

    /// <summary>
    /// How long a session that has filled its buffer is given to drain before
    /// <see cref="SlowConsumerPolicy"/> is applied.
    /// </summary>
    public int SlowConsumerTimeoutMs { get; set; } = 2000;

    /// <summary>What to do with a session that is still behind after <see cref="SlowConsumerTimeoutMs"/>.</summary>
    public SlowConsumerPolicy SlowConsumerPolicy { get; set; } = SlowConsumerPolicy.Disconnect;

    /// <summary>
    /// Idle gap after which a heartbeat is emitted, so a consumer can tell a quiet market from a
    /// dead socket. Also the value advertised in the session-start frame.
    /// </summary>
    public int HeartbeatIntervalMs { get; set; } = 1000;

    /// <summary>Socket send buffer per session.</summary>
    public int SendBufferSize { get; set; } = 256 * 1024;

    /// <summary>Bound on how long graceful shutdown waits for sessions to flush.</summary>
    public int ShutdownTimeoutMs { get; set; } = 2000;
}
