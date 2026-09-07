# Task 07 — Metrics & Structured Logging

| | |
|---|---|
| **Phase** | 2 — Mock Exchange |
| **Status** | Not started |
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

- [ ] `Meter` named `Tckr.MockExchange` with the instruments above.
- [ ] Metrics recorded per batch, never per event; zero-allocation verified.
- [ ] Rolling achieved-rate gauge, not a cumulative average.
- [ ] Structured logging throughout; no per-event logging anywhere.
- [ ] Warning-level escalation on under-delivery and on any drop/disconnect.
- [ ] No symbol-tagged instruments.

## Verification

```bash
dotnet test tests/Unit/Tckr.MockExchange.Tests --filter FullyQualifiedName~Diagnostics
dotnet run --project src/Tckr.MockExchange   # observe the 5-second status lines
```

## Notes for other tasks

Task 05 needs to call into `FeedMetrics` for session events and task 06 for batch events.
List the exact method signatures you expose here so both can code against them.
