# Task 05 — TCP Feed Server & Session Management

| | |
|---|---|
| **Phase** | 2 — Mock Exchange |
| **Status** | Done — sequence numbers count records *offered*; isolation proven; Publish averages 0.0004 ms against a stalled consumer |
| **Depends on** | 01 (`FeedFrameWriter`, `FeedRecord`) |
| **Blocks** | 06, 08 |
| **Parallel with** | 03, 04, 07 |
| **Owns** | `src/Tckr.MockExchange/Feed/**`, `tests/Unit/Tckr.MockExchange.Tests/Feed/**` |

> **Scaffolding is already done.** The test project (`tests/Unit/Tckr.MockExchange.Tests`,
> xUnit + Shouldly + `FakeTimeProvider` + `MetricCollector`), the probe project
> (`tools/Tckr.FeedProbe`), both `InternalsVisibleTo` entries, the empty area folders under
> `src/Tckr.MockExchange/`, and the `src/Tckr.slnx` registrations all exist and build.
> Add your files into the existing structure; do not re-create projects or touch the
> solution file.

---

## Objective

Accept TCP consumers, assign each a session with its own sequence numbering, write
encoded frames to them efficiently, and **deal with the ones that cannot keep up**.

---

## Why this matters

This is where the mock exchange earns its keep as a test instrument. The behaviour under
test is the one the master context calls out repeatedly:

> A slow consumer must never slow down the source.

If the feed server blocks on a slow socket, generation stalls, the achieved rate drops,
and Phase 4's ingestion benchmark measures the mock exchange's write buffer instead of
ingestion. The isolation principle that protects exchange ingestion from slow WebSocket
clients in Phase 11 is the same principle, applied one layer earlier — and this is the
first place we get to prove we understand it.

---

## Specification

### `FeedServer`

```csharp
internal sealed class FeedServer : IAsyncDisposable
{
    internal FeedServer(FeedServerOptions options, ILogger<FeedServer> logger, /* metrics */);

    internal Task StartAsync(CancellationToken ct);
    internal int ActiveSessionCount { get; }

    /// Encodes the batch once and hands the same buffer to every session. Never blocks
    /// on a slow session. Returns the number of sessions the batch reached.
    internal int Publish(ReadOnlySpan<FeedRecord> batch);

    internal Task StopAsync(CancellationToken ct);
}
```

**Encode once, fan out many.** Sequence numbers are per-session, so the naive reading is
that each session needs its own encoding. Do not accept that cost. Encode the batch once
into a pooled buffer, then patch the 8-byte sequence field per session at a known offset
(`4 + 8` from each frame start), or — simpler and preferred — keep a shared encode buffer
per session and reuse it across batches. **Measure both; pick one; record the reasoning
in the ADR (task 10).** With one or two consumers this barely matters; state that
explicitly rather than over-engineering it.

### `FeedSession`

One per accepted connection:

- `Guid SessionId`, assigned on accept.
- Its own monotonic `SequenceNumber`, starting at 1.
- A bounded outbound buffer.
- A dedicated write loop draining buffer → socket.
- Heartbeat emission when no tick has been sent for `HeartbeatIntervalMs`.

On accept, in order:

1. Log the remote endpoint and assigned session id.
2. Write the `SessionStart` frame.
3. Begin streaming ticks.

Socket configuration: `NoDelay = true` (latency over batching efficiency — we are
simulating a low-latency feed), `SendBufferSize` from options (default 256 KB).

### Backpressure and the slow-consumer policy

Use `System.IO.Pipelines` over the socket:

```csharp
new PipeOptions(
    pauseWriterThreshold: options.SessionBufferBytes,       // default 4 MB
    resumeWriterThreshold: options.SessionBufferBytes / 2,
    useSynchronizationContext: false)
```

The detection pattern:

```csharp
var flush = writer.FlushAsync(ct);
if (!flush.IsCompleted)
{
    // The pipe is paused: this consumer is behind.
    // Wait up to SlowConsumerTimeoutMs, then apply policy.
}
```

```csharp
internal enum SlowConsumerPolicy
{
    Disconnect,   // default
    DropOldest,
}
```

**`Disconnect` is the default, and that is a deliberate correctness argument.** This is a
sequenced feed. Silently dropping frames from the middle produces a sequence gap that the
consumer cannot distinguish from data loss in the network — it looks like corruption. A
clean disconnect is unambiguous: the consumer reconnects and starts a fresh session at
sequence 1. `DropOldest` exists so Phase 11 can experiment with coalescing semantics, and
when it drops, it must log and count.

Defaults: `SessionBufferBytes = 4 MB`, `SlowConsumerTimeoutMs = 2000`.

### Connection limits and lifecycle

- `MaxSessions` (default 8). Beyond it, accept then immediately close with a logged
  reason — never leave a client hanging.
- Graceful shutdown: stop accepting, flush outstanding buffers with a bounded timeout
  (default 2 s), close sockets, complete pipes.
- A faulted session must never propagate to `FeedServer` or other sessions. Catch per
  session, log with the session id, remove from the roster.
- Removal from the active roster must be safe against concurrent `Publish` — prefer a
  snapshot array swapped under a lock over locking on the publish path.

### Zero consumers

With no sessions connected, `Publish` returns 0 and does no work. **Generation continues
regardless** — the exchange does not care whether anyone is listening. Cover this with a
test; it is a property people accidentally optimise away.

---

## Tests

`tests/Unit/Tckr.MockExchange.Tests/Feed/`

Integration-flavoured but in-process: bind to port 0, connect a real `TcpClient`.

- Accept → first frame is a well-formed `SessionStart` with a non-empty session id.
- Sequence numbers start at 1 and increase by exactly 1 per tick.
- Two concurrent sessions each get independent numbering starting at 1.
- A session connecting mid-stream starts at 1, not at the global count.
- Heartbeat arrives within `HeartbeatIntervalMs × 1.5` when the rate is zero.
- Heartbeats are **not** sent while ticks are flowing.
- **Slow consumer:** connect a client that never reads; publish until the buffer fills;
  assert the session is disconnected within `SlowConsumerTimeoutMs × 2`, the reason is
  logged, and the metric increments.
- **Isolation:** with one stalled and one healthy consumer, the healthy one keeps
  receiving frames at full rate and loses none.
- **Publish never blocks:** `Publish` returns within a few milliseconds even with a
  stalled session (measure it; assert an upper bound).
- Abrupt client kill (`Socket.Close` without shutdown) removes the session cleanly with
  no unhandled exception.
- `MaxSessions + 1` connections: the extra one is closed with a logged reason.
- Graceful shutdown closes all sessions and completes within the timeout.
- Zero-consumer `Publish` is a no-op returning 0.

---

## Acceptance criteria

- [ ] `Publish` never blocks on a slow session — proven by the isolation test.
- [ ] Per-session sequence numbering, independent and correct.
- [ ] `SessionStart` first, heartbeats when idle, suppressed when busy.
- [ ] Slow-consumer policy configurable, `Disconnect` default, both paths counted.
- [ ] Session faults are contained; no cross-session impact.
- [ ] Graceful shutdown bounded and clean.
- [ ] Encode-once-fan-out-many approach chosen, measured, and reasoned in Notes for the ADR.

## Verification

```bash
dotnet test tests/Unit/Tckr.MockExchange.Tests --filter FullyQualifiedName~Feed
```

## Notes for other tasks

Delivered files:

```text
src/Tckr.MockExchange/Feed/FeedServer.cs
src/Tckr.MockExchange/Feed/FeedSession.cs
src/Tckr.MockExchange/Feed/SlowConsumerPolicy.cs
src/Tckr.MockExchange/Feed/FeedServerOptions.cs        placeholder, hand over to 06
src/Tckr.MockExchange/Feed/IFeedServerMetrics.cs       contract for 07
tests/Unit/Tckr.MockExchange.Tests/Feed/FeedTestHarness.cs
tests/Unit/Tckr.MockExchange.Tests/Feed/FeedServerTests.cs
tests/Unit/Tckr.MockExchange.Tests/Feed/FeedServerSlowConsumerTests.cs
```

Nothing outside `Feed/**` was touched. No package was added; `System.IO.Pipelines` is in the
shared framework.

### The sequence-number contract — read this first

**A session's sequence numbers count the records it was *offered*, not the records it was sent.**
Every record handed to `Publish` consumes one number on every session in the roster, including the
records a session cannot take because it is behind, and including the records discarded from its
buffer under `DropOldest`. A withheld record burns its number.

So `SequenceNumber` means *position in the tape since you connected*, which is what an exchange
sequence number normally means. The consequence that matters: **a gap is exactly the size of what
was lost.**

This replaces an earlier reading of the same field, and the difference is not cosmetic. Numbering
only the records that survive produces a stream numbered 1, 2, 3, … that is quietly missing a slice
of the tape and is indistinguishable from a complete one. Numbering what was offered makes the same
loss self-describing. The rest of these notes assume the second.

### For task 06 — `FeedServerOptions`

`Feed/FeedServerOptions.cs` is a placeholder marked `// TODO(task-06)`. Move it to
`Options/FeedServerOptions.cs`, change the namespace to `Tckr.MockExchange.Options`, add a
`using Tckr.MockExchange.Options;` to `FeedServer.cs`, and **delete the placeholder**. The type
name, property names and defaults must stay exactly as below, because the tests and this task's
validation are written against them:

| Property | Type | Default | Meaning |
|---|---|---|---|
| `ListenAddress` | `string` | `"0.0.0.0"` | Must parse as an `IPAddress`; the constructor throws otherwise. |
| `Port` | `int` | `5001` | `0` binds an ephemeral port. |
| `MaxSessions` | `int` | `8` | Beyond this, connections are accepted and closed at once. |
| `SessionBufferBytes` | `int` | `4 * 1024 * 1024` | Pipe pause threshold; resume is half of it. |
| `SlowConsumerTimeoutMs` | `int` | `2000` | Grace given to a paused session before the policy applies. |
| `SlowConsumerPolicy` | `SlowConsumerPolicy` | `Disconnect` | `Tckr.MockExchange.Feed.SlowConsumerPolicy`, stays in `Feed/`. |
| `HeartbeatIntervalMs` | `int` | `1000` | Idle gap before a heartbeat; also advertised in the session-start frame. |
| `SendBufferSize` | `int` | `256 * 1024` | `Socket.SendBufferSize` per session. |
| `ShutdownTimeoutMs` | `int` | `2000` | Bound on the graceful drain. |

Deliberately a plain POCO with **no** validation on it: `FeedServer`'s constructor already
validates (`ListenAddress` parses, `Port` in range, `MaxSessions >= 1`,
`SessionBufferBytes >= 88`, `SlowConsumerTimeoutMs >= 1`, `HeartbeatIntervalMs >= 0`,
`SendBufferSize >= 1`, `ShutdownTimeoutMs >= 0`) and there is a test for it. Add
`ValidateOnStart` rules on top if you want configuration errors to surface at start-up rather
than at construction, but do not duplicate the ones above.

Wiring notes for the publisher loop:

- `FeedServer(FeedServerOptions, ILogger<FeedServer>, IFeedServerMetrics? = null, TimeProvider? = null)`.
  The last two default to `NullFeedServerMetrics.Instance` and `TimeProvider.System`.
- `StartAsync(ct)` binds and returns immediately; accepting happens on a background loop.
  `LocalEndPoint` is populated by then — that is how the tests and the probe reach a port-0 bind.
- `Publish(ReadOnlySpan<FeedRecord>)` is **synchronous and non-blocking**. Call it directly from
  the generation loop; do not wrap it in `Task.Run`. It takes no lock and allocates nothing.
- `Publish` assigns sequence numbers per session — leave `FeedRecord.SequenceNumber` at whatever
  the generator produced, it is overwritten.
- `StopAsync(ct)` is idempotent, and `DisposeAsync` calls it. Wire `StopAsync` into the host's
  `StopAsync`, not into a finaliser.
- `ActiveSessionCount` is a cheap array-length read, fine to poll from a reporting timer.

### For task 07 — metrics

`Feed/IFeedServerMetrics.cs` declares exactly what this component counts. Either implement this
interface on `Diagnostics/FeedMetrics`, or write a thin adapter in 06 — the interface itself
stays in `Feed/` so the server does not depend on `Diagnostics/`.

```csharp
void SessionAccepted(Guid sessionId);
void SessionRejected(string reason);                    // "max-sessions", "server-stopping", "setup-failed"
void SessionClosed(Guid sessionId, string reason);      // see the reason tags below
void SlowConsumerDisconnected(Guid sessionId);          // always paired with a SessionClosed
void RecordsDropped(Guid sessionId, long records);      // records a session did not receive
void BytesWritten(Guid sessionId, long bytes);          // payload bytes handed to a socket
```

Reason tags are stable, low-cardinality constants on `FeedSession.Reasons`, safe as metric
dimensions: `slow-consumer`, `slow-consumer-loss`, `client-closed`, `client-reset`,
`write-failed`, `server-shutdown`.

Call-rate guidance: everything here is off the per-event path. The busiest is `BytesWritten`,
called once per socket write — once per drained batch, not once per tick — so a `Counter<long>`
with tags is fine and none of these need to be allocation-free.

One caveat on `RecordsDropped`: it is called at the point of loss, which includes the publish path
when a session is behind (once per refused *batch*, not per record). That path is already the
degraded one, but it is still `Publish`, so keep the implementation to a counter increment. Do not
put a log call, a lock, or a dictionary lookup behind it. Counting at the point of loss rather than
when a backpressure episode resolves is deliberate: it is what makes `RecordsDropped` sum to
exactly the size of the gap the consumer sees, and there is a test asserting that equality.

Counters worth exposing on top of these: `sessions.active` (an observable gauge over
`FeedServer.ActiveSessionCount`) and `published.records` / `published.sessions_reached` derived
from `Publish`'s return value, which the publisher loop in 06 already has.

### For task 08 — wire behaviour the probe must expect

- **The first frame on every connection is `SessionStart`**, always, before any tick. Read it
  first and take the session id and heartbeat interval from it; the heartbeat interval it
  advertises is the server's configured value, so use it to size the probe's staleness timeout
  (`interval x 1.5` is the bound this task's own tests use, and it holds).
- **Sequence numbers are per session, start at 1, and count records offered.** A reconnect starts
  a fresh session id and restarts at 1. Do not carry a sequence counter across reconnects, and do
  not treat a restart at 1 as a gap.
- **Only ticks consume sequence numbers.** Heartbeats and the session-start frame do not, so a
  gap check must skip them rather than count them.
- **Heartbeats carry the last tick sequence number sent on that session**, so the probe can
  confirm across a quiet stretch that it missed nothing. It is `0` before the first tick.
- **Heartbeats appear only while the session is idle.** They are emitted when the outbound pipe
  has been empty for `HeartbeatIntervalMs`, so a probe under load will legitimately see none for
  the whole run. Do not assert that heartbeats arrive while ticks are flowing.
- **Frames never straddle a record boundary in a way the reader cannot handle**, but they do
  straddle TCP segments constantly — the server writes a whole batch per flush and the socket
  splits it. Use `FeedFrameReader.TryReadFrame` over a `ReadOnlySequence` and treat `false` as
  "need more data" only.
#### What a gap means, precisely

Task 08 codes its gap detection against this, so it is spelled out rather than implied.

- **A gap of N means the exchange did not deliver N records it had for your session.** Not "may
  have"; the numbers were reserved for records that existed. `highest_seen - records_received` is
  the exact count of what you lost, at any point in the stream.
- **On this transport, every gap is exchange-side loss.** TCP delivers a byte stream reliably and
  in order or it breaks the connection, and `FeedFrameReader` throws `InvalidDataException` rather
  than resynchronising past a bad frame. So a gap in a successfully decoded stream cannot be
  network loss — the network's failure mode here is a broken connection, not a hole. A probe that
  reports "N records lost in the network" is misattributing; the exchange withheld them.
- **A gap is therefore not a corruption signal and must not be treated as one.** Under
  `DropOldest` it is the documented, expected outcome of being slow. Under the default
  `Disconnect` policy you will normally never see one, because the session is closed instead —
  but the numbering is the same under both policies, so write the check once.
- **A gap does not mean reordering or duplication.** Neither can occur on a single TCP session.
  A sequence number lower than one already seen, or a repeat, is a bug — report it loudly and
  separately from a gap.
- **A restart at 1 with a new session id is not a gap.** It is a new session. Reset the counter.
- **Distinguishing withheld-by-policy from network loss: you can, and the answer is always
  "withheld".** The distinction the probe actually needs is gap vs. EOF. A gap = the exchange
  dropped records for you. A clean EOF mid-run = the connection ended, which under the default
  policy usually means *you* were too slow and were disconnected. Report those as different
  findings; conflating them will make a probe that is itself the bottleneck look like a server
  fault.
- **The heartbeat is the complementary check.** Its `lastSeq` is the highest sequence number
  actually *written* to your session, not the highest offered. So while the socket is open:
  `lastSeq` greater than your highest received means data is still in flight or your reader is
  behind — it is not loss. A hole *below* `lastSeq` is loss, and you can already see it.
- **One blind spot, stated so the probe does not claim more than it can prove.** Records withheld
  *after* the last record actually written are invisible until the next record arrives, because
  nothing on the wire mentions their numbers. Under `Disconnect` this cannot persist — the session
  is closed. Under `DropOldest` the very next tick reveals it. It only survives if the feed goes
  permanently quiet immediately after a drop, which the probe should not attempt to detect. See
  the request to task 01 below for the change that would close it.

- **A slow probe will be disconnected, not thinned.** If the probe stops reading for long enough
  to fill `SessionBufferBytes`, the server closes the connection under the default policy. That is
  by design; a probe that sees a clean EOF mid-run should report it as "we were too slow", not as
  a server fault.
- **Nothing is expected on the inbound half.** The server reads from the socket only to notice
  EOF; anything the probe sends is discarded. Closing the probe's socket, gracefully or not,
  removes the session within a heartbeat interval or on the next write, whichever comes first.
- **`MaxSessions + 1` is closed immediately after accept.** A probe that connects and instantly
  reads EOF with no `SessionStart` was refused, not crashed. Report it as such.

### For task 10 — ADR material

**ADR 002 (slow-consumer policy).** The argument for the default changed shape while this task
was being built, and the ADR should record both the change and why the first version was wrong.

*The claim that did not survive.* The tempting justification for `Disconnect` is that the
alternative is undetectable: drop records from a sequenced feed and the consumer cannot tell
corruption from silence. As originally implemented that was true, and worse than the usual telling
— because sequence numbers were assigned when a record was *written* to a session, a session that
withheld records while it was behind and then resumed emitted 1, 2, 3, … with no gap at all. Not a
gap that looks like corruption: no gap. A silently thinned tape.

*The fix, and why it is the real deliverable here.* That is a flaw in the numbering, not an
argument for a policy, and the mitigation (disconnect so the thinning cannot happen) was treating
the symptom. Sequence numbers now count every record the session is **offered**, so a withheld or
discarded record burns its number and the consumer sees a gap exactly the size of its loss. The
failure became self-describing, which is worth more than any policy choice layered on top of it.

*The honest claim for the default, post-fix.* `Disconnect` remains the default, but on weaker and
truer grounds: **most consumers of a sequenced market feed want a complete tape, and would rather
reconnect than reason about which records they are missing.** It is a contract preference, not a
correctness necessity. Both policies are now detectable; they differ in what they promise:

| | `Disconnect` (default) | `DropOldest` |
|---|---|---|
| Promise | A complete tape, or the session ends | You may lose records, and you will see precisely which |
| On recovery after withholding | Closed (`slow-consumer-loss`) — it can no longer deliver on its promise | Kept; the gap is the disclosure |
| Consumer's recovery logic | Reconnect | Read the gap and carry on |

Three details worth recording:

1. The `slow-consumer-loss` disconnect fires **only** under `Disconnect`, and it fires even when
   the session drains successfully, because a session that has already lost records cannot deliver
   a complete tape whatever it does next. Under `DropOldest` it must not fire and does not — that
   policy's entire contract is that loss is acceptable when disclosed. Without this asymmetry the
   two policies would collapse into one, distinguished only by timeout behaviour.
2. `DropOldest` discards the oldest bytes still queued in the pipe, which had already been
   numbered. So it loses data loudly by construction, not by convention.
3. Neither policy can rescue a peer that has stopped reading altogether. Freeing our own buffer
   does nothing for a wedged socket, so `DropOldest` also ends in a disconnect after
   `SlowConsumerTimeoutMs` when the socket itself never drains. There is a test asserting this,
   because "DropOldest means the session survives" is the tempting and wrong reading.

*A generalisable point for the ADR's closing paragraph, since Phase 11 hits the same fork.* The
question "what should we do when a consumer is slow?" is downstream of "can the consumer tell what
we did?". Fix the observability of the failure first, and the policy question gets smaller and more
honest — it becomes a preference between two disclosed behaviours rather than a choice about whose
data to lose silently.

**ADR on the encode strategy — measured, decided.** Two candidates, both allocation-free:

- **A — per-session encode.** Each session encodes the batch directly into its own
  `PipeWriter.GetSpan()` memory. Full encode per session, but zero copies and no scratch buffer.
- **B — encode once, fan out and patch.** Encode the batch once into a shared scratch buffer,
  then per session copy it into the pipe's memory and overwrite the 8-byte sequence field at
  offset `4 + 8` in each 44-byte frame.

Measured on the development machine (Apple silicon, .NET 10, Release, 125-record batches —
the 5 ms batch at the 25,000/sec target — 200,000 iterations, best of three):

| Sessions | A: per-session encode | B: encode-once + patch | Winner |
|---|---|---|---|
| 1 | 1.12 ns/rec/session (140 ns/batch) | 1.81 ns/rec/session (226 ns/batch) | A |
| 2 | 1.15 ns/rec/session (289 ns/batch) | 1.28 ns/rec/session (319 ns/batch) | A |
| 4 | 1.12 ns/rec/session (558 ns/batch) | 1.01 ns/rec/session (504 ns/batch) | B |
| 8 | 1.12 ns/rec/session (1119 ns/batch) | 0.88 ns/rec/session (875 ns/batch) | B |
| 16 | 1.09 ns/rec/session (2184 ns/batch) | 0.84 ns/rec/session (1678 ns/batch) | B |

**Chosen: A.** The honest reading of that table is that the difference does not matter at the
scale this component runs at. At the default `MaxSessions` of 8 — already twice the realistic
number of consumers — B saves 244 ns per 5 ms batch, which is 0.005% of the batch budget, or
about 48 microseconds of CPU per second at 25,000 records/sec. B only pulls ahead at all beyond
two sessions, and Phase 2 exists to feed one ingestion service and one probe.

So the tie-break is not throughput, it is invariants. A encodes through `FeedFrameWriter` and
nothing else, and lands the bytes in their final destination in one step. B adds two things that
can silently rot: a hard-coded byte offset for the sequence field that no longer fails a test if
the layout changes (`FeedFrameWriter` would keep passing its own tests while the fan-out wrote
sequence numbers into the timestamp), and a scratch buffer whose lifetime has to be reasoned
about across sessions. Paying 0.005% of a batch to keep the wire layout knowable in exactly one
place is the right trade, and if a later phase ever fans out to dozens of consumers, the
measurement above says where the crossover is and B can be reintroduced with a test that asserts
the patched offset against `FeedFrameWriter`'s own output.

The benchmark source is not checked in — it is a 60-line harness that mirrors `WriteTick` — but
it is reproducible from this description, and task 09 can fold the comparison into
`benchmarks/phase-2/` if it wants the numbers on the report hardware.

### Requests for files this task does not own

**Task 01 — `Protocol/FeedRecord.cs`, the `SequenceNumber` doc comment.** Its remarks currently
read:

> A gap is data loss, never reordering, so a consumer that sees one must treat the stream as
> broken.

Under the numbering described at the top of these notes, the first clause is right and the second
is now wrong for the `DropOldest` policy, where a gap is the documented, expected disclosure of
exchange-side loss rather than a sign of a broken stream. Suggested replacement, which keeps the
useful half:

> A gap is data loss, never reordering. Under the default slow-consumer policy a consumer will not
> see one — the session is closed instead — so a gap there means the stream is broken. Under
> `DropOldest` a gap is the exchange telling the consumer exactly how many records it withheld.

Also worth adding to the summary line, since it is the field's actual contract: the counter is
consumed by every record *offered* to the session, so it counts position in the tape rather than
frames delivered.

**Task 01 (optional, not needed for Phase 2) — a `lastOffered` field in the heartbeat.** The
heartbeat's `lastSeq` is the last sequence number *written*, which is the right choice (see below)
but leaves one blind spot: records withheld after the final written record are invisible until the
next record arrives. A second 8-byte field carrying the last number *offered* would close it, at
the cost of widening a frozen frame for a case that only bites if the tape goes permanently quiet
immediately after a drop. Recorded as a known limitation rather than requested; task 10 can decide
whether the ADR wants it.

### Deviations from this brief, and why

- **Sequence numbers count records offered, not records written.** The brief implied the latter.
  See the contract section at the top and the ADR-002 note; this change was made deliberately, on
  the coordinator's instruction, after the original semantic turned out to make exchange-side loss
  invisible.
- **`Publish`'s XML comment no longer says "encodes the batch once and hands the same buffer to
  every session".** The brief asked for the two strategies to be measured and one picked; the
  measurement picked per-session encode, so the comment describes what the code does.
- **`FeedServer` exposes `LocalEndPoint` and `BindAddress`, and takes an optional
  `TimeProvider`.** Port 0 is useless without a way to read back the bound port, which the tests
  and the probe both need. The `TimeProvider` is for wire timestamps and the heartbeat timer.
- **`FeedSession` runs a small inbound receive loop** that reads from the socket purely to notice
  EOF. Without it, a consumer that disappears during a quiet market stays in the roster until the
  next write fails, which under a zero rate could be a whole heartbeat interval. It discards
  anything the peer sends; the feed is one-directional.
- **A session that recovers after withholding records is disconnected** under the default policy,
  with the distinct reason `slow-consumer-loss`. The brief only described the timeout path.
- **Sessions join the publish roster before their session-start frame is written**, not after.
  Otherwise a connection that dies during start-up never runs through the close path and leaks
  its `MaxSessions` slot. Ordering is enforced inside the session instead: it refuses every
  published batch until the session-start frame has been written, under the same lock.

### Decisions the follow-up asked for

- **The `slow-consumer-loss` disconnect applies only under `Disconnect`.** Confirmed, and it is
  what the code already did. Under `DropOldest` it must not fire: that policy's contract is
  disclosed loss, and disconnecting a session that lost records would make the two policies
  identical in the case that distinguishes them. The reason tag was renamed from
  `slow-consumer-thinning`, which described a failure mode that no longer exists — the loss is
  visible now, so nothing is being thinned invisibly. Task 07 has not run, so the rename is free.
- **Heartbeat `lastSeq` stays the last sequence number written.** Confirmed, but the reasoning in
  the request needs a correction: written-not-offered does *not* let a consumer detect missing
  trailing records — that is the one case it hides, and it is the blind spot noted above. The
  reason to keep it is the opposite one. `lastSeq` is the session's only positive delivery
  checkpoint: "everything up to N left this process", so a consumer holding less than N while the
  socket is open knows the shortfall is in flight rather than lost. Reporting the last *offered*
  number would fold exchange-side loss into that figure and destroy the checkpoint, and it would
  contradict task 01's frozen contract for the field ("the last tick sent"). Closing the blind
  spot properly needs a second field, which is task 01's to add and is requested above as
  optional.

### Verified

```text
dotnet build src/Tckr.slnx                                   Build succeeded, 0 errors
dotnet test  src/Tckr.slnx                                   245 passed, 1 skipped, 0 failed
dotnet test  --filter FullyQualifiedName~Tests.Feed          19 passed  (x8 consecutive runs)
```

Measured by the Feed suite itself, printed as test output:

```text
Publish never blocks    500 publishes x 125 records against a stalled session:
                        worst 0.045 ms, mean 0.0004 ms, total 0.2 ms
Isolation               stalled session took 77 of 200 batches; the healthy session
                        received all 10,000 records, sequence 1..10000, no gap
Slow consumer           disconnected 120 ms after backpressure was detected
                        (timeout 500 ms), reason 'slow-consumer-loss'
DropOldest              3,601 records offered, 901 delivered, 2,700 counted as dropped;
                        the last frame is numbered 3,601 of 3,601 offered
```

The last line is the whole point of the numbering change, asserted two ways: the final record
carries the sequence number of the total *offered*, and `offered - delivered` equals the dropped
count exactly. Across eight runs the loss volume varied from 500 to 4,200 records and the equality
held every time.
