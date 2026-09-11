# Task 07 — Metrics & Structured Logging

| | |
|---|---|
| **Phase** | 2 — Mock Exchange |
| **Status** | Complete |
| **Depends on** | 01 (for record shape); coordinates with 05, 06 |
| **Blocks** | 09 |
| **Parallel with** | 06, 08 |
| **Owns** | `src/Tckr.MockExchange/Diagnostics/**`, `tests/Unit/Tckr.MockExchange.Tests/Diagnostics/**` |

> **Scaffolding is already done.** The test project (`tests/Unit/Tckr.MockExchange.Tests`,
> xUnit + Shouldly + `FakeTimeProvider` + `MetricCollector`), the probe project
> (`tools/Tckr.FeedProbe`), both `InternalsVisibleTo` entries, the empty area folders under
> `src/Tckr.MockExchange/`, and the `src/Tckr.slnx` registrations all exist and build.
> Add your files into the existing structure; do not re-create projects or touch the
> solution file.

---

## Objective

Make the mock exchange's own behaviour observable, so that when a downstream benchmark
looks wrong we can tell whether the *load source* was healthy.

---

## Why this matters

Phase 14 adds observability to the platform. This task adds it to the instrument. Those
are different jobs with the same tools.

Without it, a Phase 4 result of "ingestion sustained 22K/sec" is unreadable: did ingestion
fall behind, or did the exchange never send 25K in the first place? The mock exchange must
report its **achieved** rate, not just its configured target — and it must report when it
capped, dropped, or disconnected someone.

Name instruments to match the Phase 14 conventions in the master context now, so the
dashboards built later do not need renaming.

---

## Specification

### `FeedMetrics`

A singleton wrapping a `System.Diagnostics.Metrics.Meter` named `Tckr.MockExchange`.
Chosen over Prometheus client libraries directly because it is the .NET-native path and
exports to Prometheus/OTLP later without code changes — a Phase 14 decision made early
and cheaply.

| Instrument | Type | Unit | Meaning |
|---|---|---|---|
| `mockexchange.events.generated` | Counter\<long\> | events | Records produced by the generator |
| `mockexchange.events.published` | Counter\<long\> | events | Frames handed to at least one session |
| `mockexchange.events.dropped` | Counter\<long\> | events | Dropped under `DropOldest` |
| `mockexchange.sessions.active` | ObservableGauge\<int\> | sessions | Currently connected consumers |
| `mockexchange.sessions.accepted` | Counter\<long\> | sessions | Lifetime accepts |
| `mockexchange.sessions.rejected` | Counter\<long\> | sessions | Refused at `MaxSessions` |
| `mockexchange.sessions.slow_disconnected` | Counter\<long\> | sessions | Killed by the slow-consumer policy |
| `mockexchange.rate.target` | ObservableGauge\<double\> | events/s | Rate currently requested |
| `mockexchange.rate.achieved` | ObservableGauge\<double\> | events/s | Rate actually produced (rolling 5 s) |
| `mockexchange.pacing.lag` | Histogram\<double\> | ms | Batch lateness vs. schedule |
| `mockexchange.batch.size` | Histogram\<int\> | events | Events per batch |
| `mockexchange.session.bytes_written` | Counter\<long\> | bytes | Wire volume, for throughput sanity |

Tag `session.id` on per-session counters. Do **not** tag anything with `symbol` — 250
symbols × several instruments is a cardinality problem, and the tape composition belongs
in the benchmark report (task 09), not in a live metric.

**Hot-path rule:** `RecordBatch(int count)` is called once per batch, not per event.
Counter adds are cheap but not free at 25,000/sec; batch them. Verify with the allocation
test below.

### `ThroughputReporter`

An `IHostedService` that logs a structured summary every
`ThroughputReportIntervalSeconds` (default 5):

```text
info: Tckr.MockExchange.Diagnostics.ThroughputReporter[0]
      Feed status phase=ContinuousMorning target=25000/s achieved=24987/s (99.9%)
      sessions=1 lag_p99=3.2ms dropped=0 slow_disconnects=0 uptime=00:02:15
```

Requirements:

- Structured properties (`{Phase}`, `{TargetRate}`, `{AchievedRate}`, …), never
  interpolated into the message template.
- Achieved rate from a rolling window, not a since-startup average — a since-startup
  average hides a mid-run collapse, which is exactly the failure we need to catch.
- Log at **Warning** when achieved drops below 95% of target for two consecutive
  intervals, or when any drop/slow-disconnect counter moves. A benchmark that silently
  under-delivers is the worst outcome this component can produce.
- When no consumer is connected, say so explicitly rather than reporting a healthy rate
  into the void.

### Logging conventions

- Startup: one line with seed, universe size, target rate, mode, listen endpoint, and the
  build configuration (`DEBUG` benchmark numbers are meaningless — make the config
  visible in the log).
- Session accept/close: session id, remote endpoint, reason, duration, frames sent.
- Phase transitions: from, to, new effective rate.
- Rate clamping: once per phase, at Warning.
- Never log per event or per frame, at any level. Guard anything in a loop with
  `IsEnabled`.

### Optional: Prometheus endpoint

If `Diagnostics.PrometheusPort` is set, expose `/metrics` via
`OpenTelemetry.Exporter.Prometheus.HttpListener`. Nice-to-have — Phase 14 will do this
properly across all services. Implement only if it costs nothing; otherwise leave a
`// Phase 14` note and move on.

---

## Tests

`tests/Unit/Tckr.MockExchange.Tests/Diagnostics/`

- Use `MetricCollector<T>` (`Microsoft.Extensions.Diagnostics.Testing`) to assert
  instruments are emitted with the right names, units and values.
- `RecordBatch(125)` increments the generated counter by 125, once.
- Achieved-rate gauge over a simulated window matches the recorded volume ±1%.
- Rolling window: a mid-window stall shows up as a drop in the reported rate, and does
  not get averaged away.
- Reporter logs at Warning when achieved < 95% of target twice consecutively
  (assert with `FakeLogger`).
- Reporter states "no consumers connected" when session count is 0.
- Allocation: 100,000 `RecordBatch` calls allocate zero bytes.
- No instrument is tagged with a symbol (cardinality guard — assert on the tag set).

---

## Acceptance criteria

- [x] `Meter` named `Tckr.MockExchange` with the instruments above.
- [x] Metrics recorded per batch, never per event; zero-allocation verified.
- [x] Rolling achieved-rate gauge, not a cumulative average.
- [x] Structured logging throughout; no per-event logging anywhere.
- [x] Warning-level escalation on under-delivery and on any drop/disconnect.
- [x] No symbol-tagged instruments.

## Verification

```bash
dotnet test tests/Unit/Tckr.MockExchange.Tests --filter FullyQualifiedName~Diagnostics
dotnet run --project src/Tckr.MockExchange   # observe the 5-second status lines
```

## Notes for other tasks

Delivered files:

```text
src/Tckr.MockExchange/Diagnostics/FeedMetrics.cs
src/Tckr.MockExchange/Diagnostics/RollingRateWindow.cs
src/Tckr.MockExchange/Diagnostics/ThroughputReporter.cs
src/Tckr.MockExchange/Diagnostics/StartupSummary.cs
tests/Unit/Tckr.MockExchange.Tests/Diagnostics/MeterProbe.cs
tests/Unit/Tckr.MockExchange.Tests/Diagnostics/FeedMetricsTests.cs
tests/Unit/Tckr.MockExchange.Tests/Diagnostics/FeedMetricsAllocationTests.cs
tests/Unit/Tckr.MockExchange.Tests/Diagnostics/RollingRateWindowTests.cs
tests/Unit/Tckr.MockExchange.Tests/Diagnostics/ThroughputReporterTests.cs
tests/Unit/Tckr.MockExchange.Tests/Diagnostics/StartupSummaryTests.cs
```

Nothing outside `Diagnostics/**` was touched. No package was added.

### `FeedMetrics` implements `IFeedServerMetrics` directly — no adapter

Task 05 offered two options: implement the interface on `Diagnostics/FeedMetrics`, or have task 06
write a thin adapter. **Implemented directly**, for three reasons:

1. **The dependency direction is unchanged.** `IFeedServerMetrics` stays in `Feed/`; `Diagnostics/`
   references `Feed/`. `Feed/` gains no reference to `Diagnostics/` and `FeedServer` still compiles
   and tests against `NullFeedServerMetrics`. An adapter would not have improved that — it would
   have moved the same dependency into a third type.
2. **An adapter is a type with no behaviour.** Six one-line forwards that must be kept in step with
   both sides, in a file owned by a task that has no reason to care.
3. **`RecordsDropped` is on the publish path.** An adapter puts an extra interface dispatch between
   the loss path and a counter increment. Small, but it buys nothing.

So task 06 registers one object under two service types. No adapter to write.

### For task 06 — the exact surface

Constructor:

```csharp
internal FeedMetrics(
    TimeProvider? timeProvider = null,   // defaults to TimeProvider.System
    object? scope = null,                // tests only; scopes the Meter for MetricCollector
    TimeSpan? achievedRateWindow = null) // defaults to 5 seconds
```

Called by the publisher loop, once per batch each, all allocation-free:

```csharp
void RecordBatch(int count);                            // generated + batch.size + rolling window
void RecordPacingLag(TimeSpan lag);                     // governor.CurrentLag
void RecordPublished(int records, int sessionsReached); // server.Publish's return value
void SetTarget(MarketPhase phase, double eventsPerSecond);
```

Called by the feed server, via `IFeedServerMetrics` — task 06 does not call these:

```csharp
void SessionAccepted(Guid sessionId);
void SessionRejected(string reason);
void SessionClosed(Guid sessionId, string reason);
void SlowConsumerDisconnected(Guid sessionId);
void RecordsDropped(Guid sessionId, long records);
void BytesWritten(Guid sessionId, long bytes);
```

Read back by the reporter, and available to task 09's benchmark harness:

```csharp
int      ActiveSessions            double TargetEventsPerSecond    double AchievedEventsPerSecond
MarketPhase Phase                  TimeSpan Uptime                 double PacingLagP99Ms()
long GeneratedTotal   long PublishedTotal   long DroppedTotal      long BytesWrittenTotal
long AcceptedTotal    long RejectedTotal    long ClosedTotal       long SlowDisconnectedTotal
```

Wiring, one call each:

```csharp
void BindSessionCount(Func<int> source);   // metrics.BindSessionCount(() => server.ActiveSessionCount)
```

`FeedMetrics` is `IDisposable` (it owns the `Meter`); a singleton registration disposes it with the
host.

**DI registration.** `FeedMetrics` must be a singleton registered under both service types, or the
counters split across two meters:

```csharp
services.AddSingleton(sp => new FeedMetrics(sp.GetRequiredService<TimeProvider>()));
services.AddSingleton<IFeedServerMetrics>(sp => sp.GetRequiredService<FeedMetrics>());
```

`BindSessionCount` cannot be a constructor argument — the server takes the metrics, so the metrics
cannot take the server. Call it once, after the `FeedServer` is constructed and before
`StartAsync`; the publisher service's constructor is the natural place:

```csharp
metrics.BindSessionCount(() => server.ActiveSessionCount);
```

Until it is bound the gauge answers from the accept/close ledger, which is correct but derived —
it will not notice a session the server dropped without a paired close.

**The hosted service.** Type name `ThroughputReporter`, an `IHostedService` via `BackgroundService`:

```csharp
services.AddHostedService(sp => new ThroughputReporter(
    sp.GetRequiredService<FeedMetrics>(),
    sp.GetRequiredService<ILogger<ThroughputReporter>>(),
    sp.GetRequiredService<TimeProvider>(),
    options.Value.Diagnostics.ThroughputReportIntervalSeconds));  // default 5, must be >= 1
```

The interval is a constructor argument rather than an options type because `Options/**` belongs to
task 06. `ThroughputReporter.DefaultReportIntervalSeconds` is `5` if no option is bound.

**The start-up line.** `StartupSummary.Log(logger, seed, symbolCount, targetEventsPerSecond,
sessionMode, listenEndpoint)` writes the one line that makes a run reproducible, including the
build configuration, and warns separately when the build is `DEBUG`. Call it after
`FeedServer.StartAsync` so `listenEndpoint` is the endpoint actually bound rather than the one
configured — a port-0 bind makes the difference material.

### Instruments, as emitted

| Instrument | Type | Unit | Tags | Written by |
|---|---|---|---|---|
| `mockexchange.events.generated` | `Counter<long>` | events | — | `RecordBatch` |
| `mockexchange.events.published` | `Counter<long>` | events | — | `RecordPublished` |
| `mockexchange.events.dropped` | `Counter<long>` | events | `session.id` | `RecordsDropped` |
| `mockexchange.sessions.active` | `ObservableGauge<int>` | sessions | — | bound source / ledger |
| `mockexchange.sessions.accepted` | `Counter<long>` | sessions | — | `SessionAccepted` |
| `mockexchange.sessions.rejected` | `Counter<long>` | sessions | `reason` | `SessionRejected` |
| `mockexchange.sessions.closed` | `Counter<long>` | sessions | `reason` | `SessionClosed` |
| `mockexchange.sessions.slow_disconnected` | `Counter<long>` | sessions | — | `SlowConsumerDisconnected` |
| `mockexchange.publish.sessions_reached` | `Counter<long>` | sessions | — | `RecordPublished` |
| `mockexchange.rate.target` | `ObservableGauge<double>` | events/s | — | `SetTarget` |
| `mockexchange.rate.achieved` | `ObservableGauge<double>` | events/s | — | rolling window |
| `mockexchange.pacing.lag` | `Histogram<double>` | ms | — | `RecordPacingLag` |
| `mockexchange.batch.size` | `Histogram<int>` | events | — | `RecordBatch` |
| `mockexchange.session.bytes_written` | `Counter<long>` | bytes | `session.id` | `BytesWritten` |

Meter name `Tckr.MockExchange`. Tag values are the stable constants on `FeedSession.Reasons` —
`slow-consumer`, `slow-consumer-loss`, `client-closed`, `client-reset`, `write-failed`,
`server-shutdown` — plus `max-sessions`, `server-stopping` and `setup-failed` on
`sessions.rejected`. There is a test pinning all six close reasons, so the
`slow-consumer-thinning` → `slow-consumer-loss` rename is now nailed down on this side too.

### For task 09 — reading the numbers back

Everything in the status line is available as a property on `FeedMetrics`, so the benchmark harness
does not need a metrics exporter to produce a report: `GeneratedTotal / elapsed` is the run's mean
rate, `AchievedEventsPerSecond` is the last five seconds, and `DroppedTotal` plus
`SlowDisconnectedTotal` are the two counters that invalidate a result if either is non-zero.

`StartupSummary.BuildConfiguration` is the string to put at the top of `results.md`; a Phase 2
number taken from a `DEBUG` build is not a slower measurement, it is a different one.

### Deviations from this brief, and why

- **Two instruments added.** `mockexchange.sessions.closed` (tagged `reason`), because the
  interface has a `SessionClosed` and the brief's table had nowhere to put it, and closes-by-reason
  is the most useful dimension the component has. `mockexchange.publish.sessions_reached`, which
  task 05's notes asked for.
- **`session.id` is on two instruments, not on every per-session counter.** The brief says "tag
  `session.id` on per-session counters". Applied to the lifetime counters —
  `sessions.accepted`, `sessions.closed`, `sessions.slow_disconnected` — that is a worse
  cardinality problem than the symbol tag the brief forbids: session ids are GUIDs, so the series
  count is unbounded in run length rather than bounded at 250. It is on `events.dropped` and
  `session.bytes_written`, where "which consumer?" is a question a total cannot answer. Counters
  say how many; the log line for the session says which.
- **`events.dropped`'s meaning is wider than "dropped under `DropOldest`".** `RecordsDropped` also
  fires on the publish path when a session is behind and the batch is refused, under either policy.
  The instrument's description says so. This matters for reading a benchmark: under the default
  `Disconnect` policy the counter can be non-zero on a session that is then disconnected, and its
  value is exactly the size of the sequence gap the consumer saw.
- **`RecordBatch(int count)` does not carry the pacing lag.** Splitting it into `RecordBatch` and
  `RecordPacingLag` keeps the brief's named hot-path method exactly as specified and avoids
  recording a zero-lag sample on every call that has no lag to report. Both are per batch.
- **No `/metrics` endpoint.** As the brief allows: it is a package reference, a listener socket, a
  port to configure and a surface to secure, for a job Phase 14 does once across every service.
  Everything an exporter needs is already here — point one at the `Tckr.MockExchange` meter. A
  `// Phase 14` note is in `FeedMetrics`'s remarks.
- **A `RollingRateWindow` type, and a `StartupSummary` type.** The brief's layout lists two files
  in `Diagnostics/`. The window is separated because it carries the one piece of non-obvious
  arithmetic in this task and deserved its own tests; `StartupSummary` exists so the single
  conditional-compilation block in the codebase lives in one place rather than in task 06's
  `Program.cs`.

### Measured

```text
dotnet build src/Tckr.slnx                                  Build succeeded, 0 errors
dotnet test  src/Tckr.slnx                                  327 passed, 2 skipped, 0 failed
dotnet test  --filter FullyQualifiedName~Diagnostics         43 passed  (x4 consecutive runs)
```

Allocation, Release, 100,000 calls each, `GC.GetAllocatedBytesForCurrentThread`:

```text
RecordBatch(125)                0 bytes
RecordPacingLag                 0 bytes
RecordPublished(125, 1)         0 bytes
SetTarget                       0 bytes
SessionAccepted                 0 bytes
SessionClosed(id, reason)       0 bytes
RecordsDropped(id, 125)        32 bytes/call   boxed Guid tag
BytesWritten(id, 5500)         32 bytes/call   boxed Guid tag
per-batch triple              175 ns          RecordBatch + RecordPacingLag + RecordPublished
```

The whole per-batch path is 175 ns, called 200 times a second: 35 microseconds of CPU per second at
the 25,000/sec target, and not one byte of GC pressure in the steady state. The two 32-byte
allocations are the price of the `session.id` tag and are bounded by the batch rate, not the event
rate — one small gen0 object per socket write and per refused batch. They could be removed by
caching a boxed id per session, but that needs a lookup on the publish path, which task 05
explicitly rules out and which costs more than it saves.

### Requests for files this task does not own

**Task 06 — `Options/`.** A `DiagnosticsOptions` with `ThroughputReportIntervalSeconds` (default
`5`, minimum `1`) is the only configuration this task needs. `ThroughputReporter` validates it in
its constructor, so `ValidateOnStart` is optional rather than required.

**Task 06 — `Program.cs` / `FeedPublisherService.cs`.** Three calls, listed above: the two DI
registrations, `BindSessionCount`, and `StartupSummary.Log`. Without `BindSessionCount` the
`sessions.active` gauge falls back to the accept/close ledger and still works; without the
`AddHostedService` line there are no status lines at all, which is the failure the brief's
verification step is looking for.

Note that `dotnet run --project src/Tckr.MockExchange` produces **no** status lines today, because
`Program.cs` is still the scaffold's placeholder host. That is task 06's file and task 06's wiring;
the reporter itself is covered by a test that drives its timer against a `FakeTimeProvider`.

### For the coordinator to decide

**Is `session.id` acceptable as a metric dimension at all?** It is bounded by `MaxSessions` at any
instant but unbounded over a run, since every reconnect mints a new GUID. For a Phase 2 benchmark
lasting minutes that is fine and the attribution is worth having. For a Phase 14 Prometheus scrape
of a long-lived process it is a slow leak. Two options if it is judged unacceptable later: drop the
tag and rely on the per-session close log line, which already carries bytes written and records
dropped; or replace the GUID with a small monotonic session ordinal, which is bounded by reconnect
count rather than by time and reads better on a dashboard. Both are one-line changes here; the
second needs an ordinal from task 05's `FeedSession`.
