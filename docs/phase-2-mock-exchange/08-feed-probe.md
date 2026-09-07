# Task 08 — `Tckr.FeedProbe` Verification Client

| | |
|---|---|
| **Phase** | 2 — Mock Exchange |
| **Status** | Not started |
| **Depends on** | 01 (`FeedFrameReader`), 05 (a server to connect to) |
| **Blocks** | 09 |
| **Parallel with** | 06, 07 |
| **Owns** | `tools/Tckr.FeedProbe/**` |

> **Scaffolding is already done.** The test project (`tests/Unit/Tckr.MockExchange.Tests`,
> xUnit + Shouldly + `FakeTimeProvider` + `MetricCollector`), the probe project
> (`tools/Tckr.FeedProbe`), both `InternalsVisibleTo` entries, the empty area folders under
> `src/Tckr.MockExchange/`, and the `src/Tckr.slnx` registrations all exist and build.
> Add your files into the existing structure; do not re-create projects or touch the
> solution file.

---

## Objective

An independent consumer that connects to the feed, decodes it, and **proves** what the
mock exchange actually delivered: rate, gaps, ordering, distribution.

---

## Why this matters

Self-reported metrics (task 07) tell us what the exchange *believes* it sent. They cannot
detect a framing bug, a sequence bug, or bytes lost between the pipe and the socket —
those are exactly the failures that would make every downstream measurement wrong while
looking perfectly healthy in the logs.

The probe is the independent witness. It is also the tool used constantly during Phases 3
and 4 to answer "is the exchange actually running and sane?" in one command, and it is a
reference implementation of the wire protocol for whoever writes ingestion next.

---

## Specification

### Project

`tools/Tckr.FeedProbe/` **already exists** as a console app (`net10.0`, `Exe`) with a
project reference to `Tckr.MockExchange`, a solution entry, and `InternalsVisibleTo`
wiring. `Program.cs` is a stub that exits 3 — replace it.

>
> Alternative worth considering and recording in the ADR: copy the reader into the probe
> so it is a genuinely independent implementation. A shared codec means a layout bug is
> invisible to both sides. Copying is duplication but stronger evidence. Task 01 already
> pins the layout with a hard-coded byte-level test, which mitigates most of this — make
> the call, and write down which and why.

### CLI

```bash
dotnet run --project tools/Tckr.FeedProbe -- \
    --host localhost --port 9001 \
    --duration 60 \
    --report-interval 5 \
    --output benchmarks/phase-2/probe-25k.json \
    --top-symbols 20 \
    --verify-order
```

| Flag | Default | Meaning |
|---|---|---|
| `--host` | `localhost` | Feed host |
| `--port` | `9001` | Feed port |
| `--duration` | `60` | Seconds to run; `0` = until Ctrl+C |
| `--report-interval` | `5` | Console summary cadence, seconds |
| `--output` | none | Write the final report as JSON to this path |
| `--top-symbols` | `20` | Symbols to include in the distribution table |
| `--verify-order` | `false` | Also assert per-symbol timestamp monotonicity |
| `--stall-after` | none | Stop reading after N seconds — used to test the slow-consumer policy |

Use `System.CommandLine`, or hand-rolled parsing if that adds friction. Do not add a
dependency for six flags if it costs more than it saves.

### Measurements

- **Sequence integrity** — the headline number. Every gap recorded as
  `(expectedSeq, receivedSeq, gapSize, timestamp)`. Any gap is a failure.
- **Achieved rate** — events/sec, rolling and overall, plus min/max over the run.
- **Bytes/sec** on the wire, and mean bytes/event.
- **Inter-arrival jitter** — p50/p95/p99/max gap between consecutive frames. This is what
  reveals whether the rate governor is delivering smoothly or in lumps; a "25K/sec" feed
  that emits 125,000 events once every five seconds would pass a naive rate check and
  fail here.
- **One-way delivery latency** — `receiveTime - exchangeTimestamp`. Clocks are shared
  (same host) in Phase 2, so this is meaningful now and becomes unreliable once processes
  span machines. Say so in the output; do not let a future reader trust it blindly.
- **Symbol distribution** — top N by count with percentage share, plus the top-1 /
  top-10 / top-50 cumulative shares. This is the number that proves the tape is skewed.
- **Message-type mix** — trade / bid / ask percentages.
- **Price sanity** — per symbol: min, max, and any move exceeding the configured tick
  limit.
- **Heartbeats** — count, and any interval exceeding 2× the configured value.
- **Framing errors** — malformed length prefix, unknown message type, bad symbol padding.

### Output

Console summary at each interval, plus a final block:

```text
════════════════════════════════════════════════════════════
 Tckr.FeedProbe — session 6f2c…9a1b — 60.0s
────────────────────────────────────────────────────────────
 Events received      1,499,182
 Achieved rate        24,986 /s   (target 25,000 — 99.9%)
 Sequence gaps        0
 Framing errors       0
 Wire throughput      1.10 MB/s   (44.0 bytes/event)
 Inter-arrival        p50 0.04ms  p95 0.09ms  p99 4.8ms  max 12.1ms
 Delivery latency     p50 0.21ms  p95 0.55ms  p99 3.2ms  max 11.7ms
 Message mix          trade 40.0%  bid 30.0%  ask 30.0%
 Symbol skew          top-1 14.2%  top-10 57.8%  top-50 88.1%
────────────────────────────────────────────────────────────
 RESULT: PASS
════════════════════════════════════════════════════════════
```

Exit codes: `0` pass, `1` sequence gaps or framing errors, `2` achieved rate outside ±2%
of the stated target, `3` connection failure. Task 09 and any future CI check depend on
these, so make them exact.

`--output` writes the same data as JSON for task 09 to consume.

### Implementation notes

- Read with `System.IO.Pipelines` over the socket; `FeedFrameReader.TryReadFrame` handles
  partial frames.
- The probe must be **faster than the feed**. Do not compute percentiles inline — record
  raw samples into a pre-allocated array (or a reservoir if `--duration 0`) and compute at
  the end. A probe that becomes the bottleneck measures itself.
- Per-symbol counters in a pre-sized array indexed by a symbol→index map built lazily on
  first sight. No dictionary lookup per event on the hot path if avoidable.
- Handle Ctrl+C by printing the report before exiting.

---

## Acceptance criteria

- [ ] Connects, decodes `SessionStart`, streams, and reports.
- [ ] Detects and reports sequence gaps; exits non-zero on any.
- [ ] Reports achieved rate, jitter percentiles, latency percentiles, skew, mix.
- [ ] Keeps up with 25K/sec without becoming the bottleneck — verify probe CPU is well
      below saturation and that two probes report the same rate.
- [ ] `--output` produces JSON consumable by task 09.
- [ ] `--stall-after` reproduces the slow-consumer disconnect from the client side.
- [ ] Exit codes exactly as specified.

## Verification

```bash
dotnet run --project src/Tckr.MockExchange &
dotnet run -c Release --project tools/Tckr.FeedProbe -- --duration 30 --output /tmp/probe.json
echo "exit=$?"
```

## Notes for other tasks
