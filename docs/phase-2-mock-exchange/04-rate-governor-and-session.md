# Task 04 — Rate Governor & Market Session Phases

| | |
|---|---|
| **Phase** | 2 — Mock Exchange |
| **Status** | Done — measured 0.05% rate error over a real 10 s run |
| **Depends on** | — (build against the interfaces below; no other task's code required) |
| **Blocks** | 06 |
| **Parallel with** | 01, 02, 03, 05 |
| **Owns** | `src/Tckr.MockExchange/Session/**`, `tests/Unit/Tckr.MockExchange.Tests/Session/**` |

> **Scaffolding is already done.** The test project (`tests/Unit/Tckr.MockExchange.Tests`,
> xUnit + Shouldly + `FakeTimeProvider` + `MetricCollector`), the probe project
> (`tools/Tckr.FeedProbe`), both `InternalsVisibleTo` entries, the empty area folders under
> `src/Tckr.MockExchange/`, and the `src/Tckr.slnx` registrations all exist and build.
> Add your files into the existing structure; do not re-create projects or touch the
> solution file.

---

## Objective

Answer one question accurately, thousands of times per second: **how many events should
have been emitted by now?** Then shape that number across a trading day.

---

## Why this matters

This is the component that decides whether "25,000 events/sec" is a real claim or a
label on a chart. Every downstream latency and throughput number in Phases 4, 9, 15 and
16 is measured against the rate this class produces. If it drifts 8% low, so does every
conclusion drawn from it.

The naive implementation — `await Task.Delay(1)` in a loop — is wrong in three ways:
timer granularity is coarse and platform-dependent, error accumulates because each sleep
starts from *now* rather than from the schedule, and there is no catch-up policy after a
GC pause. Schedule against absolute deadlines, not relative sleeps.

---

## Specification

### `RateGovernor`

```csharp
internal sealed class RateGovernor
{
    internal RateGovernor(int batchIntervalMs, int maxCatchUpBatches, TimeProvider? timeProvider = null);

    /// Blocks until the next batch is due, then returns how many events to emit.
    internal ValueTask<int> WaitForNextBatchAsync(double eventsPerSecond, CancellationToken ct);

    internal long TotalEventsScheduled { get; }
    internal TimeSpan CurrentLag { get; }        // how far behind schedule we are
    internal long CatchUpBatchesDropped { get; } // schedule resets after falling too far behind
}
```

**Debt-based accounting.** Track events owed as a running `double`, not as a per-batch
integer:

```text
owed += elapsedSeconds × eventsPerSecond
emit  = (int)owed
owed -= emit                       // fractional remainder carries to the next batch
```

Carrying the fraction is what makes non-round rates (e.g. 25,000 events across 5 ms
batches, or 17,384/sec) accurate over a minute instead of drifting.

**Deadline scheduling.** Advance `nextDeadline += batchInterval` from the previous
deadline. Never from `now`.

**Catch-up cap.** If the loop falls behind by more than `maxCatchUpBatches` (default 4),
do **not** attempt to emit the full backlog — that is a death spiral under load. Emit the
capped amount, reset the schedule to now, increment `CatchUpBatchesDropped`, and log a
warning. A mock exchange that lies about its rate is worse than one that admits it fell
behind.

**Hybrid wait.** `Task.Delay` cannot reliably wake at 5 ms granularity across platforms.
Use a hybrid: `Task.Delay` while more than `SpinThresholdMs` (default 2 ms) remains, then
`Thread.SpinWait` / `Thread.Yield` for the remainder. Document the CPU cost — this
deliberately trades a fraction of a core for pacing accuracy, which is the right trade
for a load generator and the wrong trade for a server.

Defaults: `batchIntervalMs = 5` (→ 125 events/batch at 25K), `maxCatchUpBatches = 4`.

### `MarketPhase`

```csharp
internal enum MarketPhase
{
    Closed, PreOpen, OpeningAuction, ContinuousMorning,
    MiddayLull, ContinuousAfternoon, ClosingAuction,
}
```

### `MarketSessionClock`

```csharp
internal sealed class MarketSessionClock
{
    internal MarketPhase CurrentPhase { get; }
    internal double CurrentRateMultiplier { get; }
    internal double EffectiveEventsPerSecond(double baseRate);   // multiplier × base, clamped
    internal event Action<MarketPhase, MarketPhase>? PhaseChanged;
    internal void Advance(DateTimeOffset now);
}
```

Three modes, configurable:

| Mode | Behaviour |
|---|---|
| `Continuous` *(default)* | Always `ContinuousMorning`, multiplier `1.0`. Deterministic; the mode benchmarks run in. |
| `Scheduled` | Real wall-clock times in the configured exchange timezone. |
| `CompressedDay` | The whole session mapped into `CompressedDurationMinutes` (default 5). Demo mode. |

Default schedule (exchange local time, all configurable):

```text
Phase                  Window          Multiplier
──────────────────────────────────────────────────
PreOpen                09:30 – 10:00       0.10
OpeningAuction         10:00 – 10:05       3.00
ContinuousMorning      10:05 – 12:00       1.20
MiddayLull             12:00 – 13:30       0.60
ContinuousAfternoon    13:30 – 14:15       1.00
ClosingAuction         14:15 – 14:30       2.50
Closed                 otherwise           0.00
```

`EffectiveEventsPerSecond` clamps the result at `MaxEventsPerSecond` (default 100,000) so
an auction multiplier cannot accidentally ask for a rate the box cannot serve. When the
clamp engages, log it once per phase — silently capping is how a benchmark ends up
measuring the wrong thing.

Take a `TimeProvider` so phase transitions are testable without waiting for lunchtime.

---

## Tests

`tests/Unit/Tckr.MockExchange.Tests/Session/`

Use `FakeTimeProvider` (`Microsoft.Extensions.TimeProvider.Testing`) throughout.

- **Accuracy:** 60 simulated seconds at 25,000/sec schedules 1,500,000 ± 0.5% events.
- **Fractional carry:** 17,384/sec over 60 s lands within ±0.5%; the classic
  integer-truncation bug loses ~2% here.
- **No drift:** total scheduled after 10 simulated minutes matches `rate × 600` ± 0.5%.
- **Catch-up cap:** simulate a 500 ms stall; emitted batch is capped, schedule resets,
  `CatchUpBatchesDropped` increments, and the following batches are normal-sized.
- **Rate change:** switching the requested rate mid-stream takes effect on the next batch
  without a burst or a gap.
- **Zero rate:** `Closed` schedules zero events and does not spin hot.
- **Phase transitions:** each boundary produces exactly one `PhaseChanged` event with the
  correct from/to values.
- **CompressedDay:** all seven phases occur, in order, within the configured window.
- **Clamp:** base 50,000 × auction 3.0 clamps to `MaxEventsPerSecond`, logged once.
- **Wall-clock sanity** (not fake time, Release, marked `Category=Benchmark`): 10 real
  seconds at 25,000/sec, achieved within ±2% and per-batch jitter p99 < 15 ms.

---

## Acceptance criteria

- [ ] Debt-based accounting with fractional carry.
- [ ] Absolute-deadline scheduling; no relative sleep accumulation.
- [ ] Catch-up capped and counted, never unbounded.
- [ ] Hybrid delay/spin wait, with the CPU trade-off documented in XML docs.
- [ ] Seven phases with configurable windows and multipliers, three modes.
- [ ] `TimeProvider` injected; all phase logic tested against fake time.
- [ ] Accuracy within ±0.5% under fake time and ±2% on a real 10-second run.

## Verification

```bash
dotnet test tests/Unit/Tckr.MockExchange.Tests --filter FullyQualifiedName~Session
dotnet test tests/Unit/Tckr.MockExchange.Tests -c Release --filter Category=Benchmark
```

## Notes for other tasks

### For task 06 — the options class to create

`MarketSessionOptions` and `MarketPhaseWindow` currently live in
`src/Tckr.MockExchange/Session/MarketSessionOptions.cs`, marked `// TODO(task-06)`. **Move that
file verbatim to `Options/MarketSessionOptions.cs`.** If you keep the namespace
`Tckr.MockExchange.Session`, nothing else changes; if you move it to `Tckr.MockExchange.Options`,
add `using Tckr.MockExchange.Options;` to `Session/MarketSessionClock.cs` — that is the only
edit needed in a file task 04 owns, and it is pre-approved.

The shape, verbatim (property names and defaults are asserted by `MarketSessionClockTests`):

| Property | Type | Default | Notes |
|---|---|---|---|
| `Mode` | `MarketSessionMode` | `Continuous` | `Continuous` / `Scheduled` / `CompressedDay` |
| `TimeZone` | `string` | `"UTC"` | IANA or Windows id; unknown ids fall back to UTC with a warning |
| `CompressedDurationMinutes` | `int` | `5` | length of one `CompressedDay` cycle |
| `CompressedClosedFraction` | `double` | `0.10` | leading `Closed` share of a compressed cycle |
| `MaxEventsPerSecond` | `double` | `100_000` | ceiling applied after the phase multiplier |
| `Phases` | `IList<MarketPhaseWindow>` | the seven-phase default schedule | `Phase`, `Start`, `End` (`TimeSpan`), `RateMultiplier` |

`SectionName` is currently `"MockExchange:MarketSession"` — change it if your section layout
differs; nothing outside the options file reads it.

Two binding traps already handled, please keep them: the class is `internal` but its **properties
are `public`**, because `Microsoft.Extensions.Configuration`'s reflection binder skips non-public
properties unless `BindNonPublicProperties` is set (it would bind to silence, not to an error);
and `Phases` is `IList<T>` rather than `IReadOnlyList<T>` so the binder can populate it.

The default `TimeZone` is `"UTC"` rather than a real venue's zone on purpose: a benchmark whose
phase schedule depends on the CI runner's region is not reproducible. `appsettings.Development.json`
is the right place to set a real zone for a demo.

### For task 06 — the surface to drive the publisher loop from

```csharp
var session  = new MarketSessionClock(options, timeProvider, logger);
var governor = new RateGovernor(batchIntervalMs: 5, maxCatchUpBatches: 4, timeProvider, logger);

while (!ct.IsCancellationRequested)
{
    session.Advance(timeProvider.GetUtcNow());
    double rate = session.EffectiveEventsPerSecond(options.BaseEventsPerSecond);
    int count = await governor.WaitForNextBatchAsync(rate, ct);
    // generate `count` records, encode, publish
}
```

- `WaitForNextBatchAsync(double eventsPerSecond, CancellationToken)` → `ValueTask<int>` is the
  contract. **Call `session.Advance` before it, not after**: the rate passed in is the rate that
  batch is paced at.
- The **first call returns immediately** with one batch's worth of events and anchors the
  schedule there, so constructing the governor at host start and beginning the loop later does
  not look like a stall.
- It returns `0` legitimately (a `Closed` phase, or a rate low enough that the debt has not yet
  reached one whole event). Treat `0` as "no work this batch", not as end-of-stream, and do not
  add a delay of your own around it — the governor is already the pacer.
- Both constructors take **two extra optional parameters beyond the ones in this brief**:
  `ILogger<T>? logger = null` (the spec gave no logger, but the catch-up cap and the rate clamp
  both have to be visible) and, on the governor, `double spinThresholdMs = 2.0`. Registering them
  in DI with the real `ILogger<T>` is enough.
- Neither type is thread-safe. One governor and one clock per publisher loop; `PhaseChanged`
  handlers run inline on that loop, so keep them to a metric increment or a log line.
- Register `TimeProvider.System` as a singleton and inject it into both. Everything in
  `Session/` is tested against `FakeTimeProvider`; nothing calls `DateTimeOffset.UtcNow`.

### For task 07 — metrics worth publishing

`RateGovernor` exposes `TotalEventsScheduled`, `CurrentLag`, `CatchUpBatchesDropped` and
`SpinIterations`; `MarketSessionClock` exposes `CurrentPhase` and `CurrentRateMultiplier`.
`CatchUpBatchesDropped` is the one that matters: **any non-zero value invalidates the achieved-rate
claim for that run**, so it belongs on the benchmark report, not only in a log line.

### For task 09 — measured numbers

10 s at 25,000/sec, Release, Apple silicon, `--filter Category=Benchmark`, three runs:

| Run | Achieved | Error | Jitter p50 | p99 | max | Dropped |
|---|---|---|---|---|---|---|
| 1 | 25,012.6/s | 0.051% | 0.002 ms | 0.020 ms | 2.4 ms | 0 |
| 2 | 24,950.7/s | 0.197% | 0.002 ms | 4.192 ms | 32.8 ms | 4 |
| 3 | 25,012.5/s | 0.050% | 0.002 ms | 0.011 ms | 10.4 ms | 0 |

Run 2 is the interesting one: a real ~33 ms stall, the catch-up cap engaging as designed, and the
achieved rate still inside 0.2%. Jitter is measured as `CurrentLag` per batch — how late each
batch woke against the deadline it was scheduled for. Do **not** measure it as
`elapsed - callCount x interval`: one call covers several intervals whenever a short stall is made
up within the cap, so that metric reports a permanent offset the pacing does not have. It cost an
hour here.

### For task 10 — ADR material

1. **Debt-based pacing with fractional carry, on absolute deadlines.** Measured: at 17,384
   events/sec over 5 ms batches, per-batch integer truncation loses 1.06% for ever (asserted in
   `CarriesTheFractionalRemainderAtNonRoundRates`); carrying the fraction lands inside 0.5% over
   60 simulated seconds and 0.05% over a real 10 s run. Relative sleeps from `now` accumulate every
   overshoot; deadlines advanced from their predecessor do not.
2. **The catch-up cap is a correctness decision, not a tuning knob.** Emitting an unbounded
   backlog turns a GC pause into a burst and the burst into a longer pause. The governor emits at
   most `1 + maxCatchUpBatches` intervals' worth, abandons the rest, counts it and warns.
3. **Spinning for the last 2 ms.** A deliberate trade of up to 2 ms of CPU in every 5 for a median
   jitter of ~2 microseconds. Right for a load generator, wrong for a server — worth stating
   explicitly so nobody copies the pattern into the gateway.
4. **`Continuous` is the default session mode.** Phase shaping is a demo and realism feature; a
   benchmark whose target rate moves under it is not a measurement.

### Requests for files task 04 does not own

None outstanding, other than the `MarketSessionOptions` move described above.

### Deliberately not built (out of scope per this brief)

No exchange calendar, holidays, half-days, weekend handling, or auction micro-structure.
`Scheduled` mode is time-of-day only: it will report `PreOpen` at 09:30 on a Saturday. If a later
phase wants a calendar, it is an additive change to `MarketSessionClock.Resolve`.
