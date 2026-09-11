# Task 08 — `Tckr.FeedProbe` Verification Client

| | |
|---|---|
| **Phase** | 2 — Mock Exchange |
| **Status** | Done — verified against the live server at 25,000/s with zero gaps; `--stall-after` verified against both slow-consumer policies with exact drop-count agreement against the server's own logs |
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

### Inbound requests from completed tasks

**From task 05 — the gap contract.** Read the "For task 08 — wire behaviour the probe must
expect" section of `05-tcp-feed-server.md` before writing the decoder. The headline: sequence
numbers count records **offered**, so a gap is exactly the size of what was lost, and on this
transport every decoded gap is exchange-side loss — TCP delivers in order or breaks, and
`FeedFrameReader` throws rather than resynchronising. The distinction you need is therefore
**gap vs. EOF**, not withheld-vs-network.

**From task 06 — `AuctionPrintFlag` is now set, but you still must not assert on it.** Task 06
has landed and stamps the bit over each batch from the market phase it holds. It is set on
**trades only**, and only while the phase is `OpeningAuction` or `ClosingAuction` — quotes never
carry it, because an auction print is a print.

The reason the original instruction stands is the default configuration: `Session:Mode` is
`Continuous`, which is permanently `ContinuousMorning` and never an auction, and it is the mode
every benchmark runs in. So on a default run every record on the wire still has `Flags = 0`, and a
probe that requires the flag to appear fails against the configuration it will actually meet.
Decode the field, report the count, and make it an observation rather than an assertion. To see it
set at all, run the exchange with `MockExchange__Session__Mode=CompressedDay`, which cycles a whole
trading day — auctions included — every five minutes.

---

## Acceptance criteria

- [x] Connects, decodes `SessionStart`, streams, and reports.
- [x] Detects and reports sequence gaps; exits non-zero on any (under the default policy,
      or always for a reorder/duplicate — see "Notes for other tasks" for the
      `--expect-drops` exception under `DropOldest`).
- [x] Reports achieved rate, jitter percentiles, latency percentiles, skew, mix.
- [x] Keeps up with 25K/sec without becoming the bottleneck — verified: probe CPU sampled
      at 0.0% (`ps -o pcpu`) throughout a 20s run at 25,000/s, and two probes run
      concurrently against the same server reported 25,007/s and 25,013/s (0.02% apart).
- [x] `--output` produces JSON consumable by task 09.
- [x] `--stall-after` reproduces the slow-consumer disconnect from the client side —
      verified against both policies; see "Notes for other tasks" for the numbers.
- [x] Exit codes exactly as specified.

## Verification

```bash
dotnet run --project src/Tckr.MockExchange &
dotnet run -c Release --project tools/Tckr.FeedProbe -- --duration 30 --output /tmp/probe.json
echo "exit=$?"
```

## Notes for other tasks

Delivered files, all under `tools/Tckr.FeedProbe/` (plus this brief):

```text
tools/Tckr.FeedProbe/Program.cs           entry point: parse, run, print, write JSON, exit
tools/Tckr.FeedProbe/ProbeOptions.cs      CLI parsing (hand-rolled) and --help text
tools/Tckr.FeedProbe/ProbeSession.cs      connect, handshake, read loop, measurement, report assembly
tools/Tckr.FeedProbe/SymbolTable.cs       per-symbol counters, array-backed, lazily-indexed
tools/Tckr.FeedProbe/ReservoirSampler.cs  fixed-capacity uniform reservoir (Algorithm R)
tools/Tckr.FeedProbe/PercentileSummary.cs p50/p95/p99/max over a reservoir snapshot
tools/Tckr.FeedProbe/Events.cs            GapEvent, SequenceIntegrityViolation, FramingErrorEvent, OrderViolationEvent
tools/Tckr.FeedProbe/ProbeReport.cs       the aggregated result of one run
tools/Tckr.FeedProbe/ConsoleReport.cs     console rendering (progress line + final block)
tools/Tckr.FeedProbe/JsonReport.cs        --output JSON rendering
```

No package was added. `System.CommandLine` was considered and rejected: nine scalar flags, no
subcommands, no completion needs — the hand-rolled parser in `ProbeOptions.Parse` is ~80 lines
and every flag's default, validation and `--help` text live next to each other. `System.IO.Pipelines`
needed no package reference either; it is part of the shared framework in .NET 10, same as it is for
`Tckr.MockExchange` itself.

### Codec decision: shared, not copied

Uses `FeedFrameReader` directly via `InternalsVisibleTo`, not a second hand-written decoder. The
brief's own framing of the trade-off — a shared codec hides a layout bug from both sides, a copy
buys a second, independent opinion — is the right question, but task 01 already answers it: the
wire layout is pinned by a hard-coded byte-level test, so a second decoder would not be checking the
layout against anything, only encoding the same 44/28/36-byte contract a second time in a different
file, with no test forcing the two to agree when one changes. That is a maintenance liability, not
independence. What this probe is actually an independent witness to — sequencing, pacing,
distribution, loss — lives above the framing layer entirely, and a duplicated decoder would not make
any of those measurements more trustworthy. The reasoning is written on `ProbeSession`'s class
remarks in the source, since that is where task 10 will look for it when it turns this into ADR
material.

### The CLI and exit-code contract task 09 will script against

```text
dotnet run --project tools/Tckr.FeedProbe -c Release -- \
    --host <name>              default localhost
    --port <n>                 default 9001
    --duration <seconds>       default 60; 0 = until Ctrl+C
    --report-interval <sec>    default 5
    --output <path>            write the final report as JSON here
    --top-symbols <n>          default 20
    --verify-order             assert per-symbol timestamp monotonicity
    --stall-after <seconds>    stop reading after N seconds, to exercise the slow-consumer policy
    --stall-duration <seconds> default 5 — how long that pause lasts before reading resumes
    --target-rate <events/s>   default 25000 — see "flags added beyond the brief" below
    --expect-drops             the server runs DropOldest; a sequence gap is not a failure
```

Exit codes, exact:

| Code | Meaning |
|---|---|
| `0` | Pass. |
| `1` | A sequence gap while `--expect-drops` was not passed, a sequence-number reorder/duplicate (always, regardless of the flag), or a framing error. |
| `2` | Achieved rate (events received ÷ active seconds, where "active" excludes any `--stall-after` pause) outside ±2% of `--target-rate`. |
| `3` | No session was ever established — TCP connect failure, or the connection closed before a `SessionStart` frame arrived (including a `MaxSessions`-refused connection: reported as `refused`, not as a crash). |
| `64` | Malformed command line. Not one of the four codes above on purpose — BSD `sysexits.h`'s "usage error" convention, chosen because it is not a measurement outcome task 09 should ever need to branch on. |

Priority when more than one condition holds: `3` (nothing was measurable) beats `1` (the tape
cannot be trusted) beats `2` (a pacing complaint about an otherwise-trustworthy tape).

**Flags added beyond the brief's table, and why**: `--target-rate`, `--stall-duration`,
`--expect-drops`. The brief's own sample console output prints `(target 25,000 — 99.9%)` and the
exit-code contract requires an "outside ±2% of target" comparison, but none of the six listed flags
supply that number — `--target-rate` closes that gap (defaulting to 25,000, `Session:
BaseEventsPerSecond`'s own default). `--stall-duration` controls how long `--stall-after`'s pause
lasts before reading resumes; without a resume inside the same run, a stall test can only prove "the
server eventually gives up", not show the disconnect or the gap directly. `--expect-drops` is how the
probe learns which slow-consumer policy is in force — see the next section.

### How the probe learns the slow-consumer policy

The wire carries no field naming `Disconnect` vs. `DropOldest`, and a decoded gap means the same
thing under both — the exchange withheld records and told you exactly how many — but a different
thing about whether the run passed. `--expect-drops` is that missing piece: without it, any gap is
exit `1`; with it, a gap is reported but does not by itself fail the run (a reorder/duplicate still
does, unconditionally — that is never legitimate under either policy). This was an explicit decision
this task had to make, flagged as open in the coordinator's brief; the alternative considered was
always exiting `0` on a gap and leaving interpretation to whoever reads the report, which was
rejected because it removes the one thing an exit-code contract exists to provide: something task 09
can branch on without parsing prose.

### The JSON report schema (`--output`)

Top level: `schemaVersion` (`1`), `host`, `port`, `sessionEstablished`, `sessionId`,
`startedAtUtc`, `endedAtUtc`, `activeSeconds`, `endReason`
(`duration-elapsed`/`ctrl-c`/`eof`/`reset`/`stale`/`framing-error`/`refused`/`connect-failed`),
`result` (`PASS`/`FAIL`), `exitCode`. If `sessionEstablished` is `false` those are the only fields
present — nothing downstream of a connection was ever measured.

Otherwise, also: `heartbeatIntervalMsAdvertised`, `eventsReceived`, `achievedRate` (`overall`,
`min`, `max`, `target`, `targetPercent`), `sequence` (`gapCount`, `recordsLost`, `expectDrops`,
`gaps[]` as `{expectedSeq, receivedSeq, gapSize, timestampUtc}`, `integrityViolationCount`,
`integrityViolations[]`), `framingErrors` (`count`, `errors[]`), `wire` (`totalBytes`,
`bytesPerSecond`, `meanBytesPerEvent`), `interArrivalMs` / `deliveryLatencyMs` (each
`p50`/`p95`/`p99`/`max`, the latter carrying the same-host-clock caveat as a `note`), `messageMix`
(`trade`/`bid`/`ask` counts), `symbolSkew` (`distinctSymbolsSeen`, `top1Percent`, `top10Percent`,
`top50Percent`, `topSymbols[]`), `priceSanity` (`perSymbol[]` — see the deviation below),
`auctionPrintFlag` (`observedCount`), `heartbeats` (`count`, `configuredIntervalMs`,
`maxIntervalMs`, `exceeded2xCount`), `verifyOrder` (`enabled`, `violationCount`, `violations[]`),
`stall` (`requestedAfterSeconds`, `pauseDurationSeconds`, `outcome`:
`n/a`/`continued`/`eof`/`reset`/`stale`/`interrupted`/`framing-error`). Every section that needs
context carries its own `note` field inline rather than relying on this document, since task 09 will
be parsing the file, not this brief.

### Measured, against the live server (Apple silicon, .NET 10, Release; `UniverseSize=250`, `BaseEventsPerSecond=25000`)

```text
30s run, default Disconnect policy, no stall:
  Events received      750,250        Achieved rate  25,004/s (100.0% of 25,000 target)
  Sequence gaps        0              Framing errors 0
  Wire throughput      1.05 MB/s (44.0 bytes/event, exactly TickFrameSize)
  Inter-arrival        p50 0.00ms  p95 0.00ms  p99 0.00ms  max 5.15ms
  Delivery latency     p50 1.16ms  p95 1.22ms  p99 1.23ms  max 2.14ms
  Symbol skew          top-1 14.4%  top-10 59.2%  top-50 98.7%  (250 symbols; COMI leads, as the
                        master context's own example predicts)
  Message mix          trade 40.1%  bid 30.0%  ask 29.9%   (matches configured 40/30/30 shares)
  RESULT: PASS (exit 0)

Two probes, concurrent, same server, 15s each:
  Probe A: 375,125 events, 25,007/s   Probe B: 375,250 events, 25,013/s   (0.02% apart, both PASS)

Probe CPU: ps -o pcpu sampled every 3s across a 20s run at 25,000/s — 0.0% every sample.

--stall-after 5 --stall-duration 5, default Disconnect policy:
  Paused at t=5s. Server's own log: "is behind: its 4194304-byte outbound buffer is full... "
  then closes the session before the probe ever resumes reading (its SlowConsumerTimeoutMs=2000ms
  grace expires mid-pause). On resume the probe drains what the OS had already buffered before the
  close (111,250 further events, perfectly contiguous) and then observes EOF.
  Sequence gaps: 0.  Stall outcome: eof.  End reason: eof.
  This is the contract from 05-tcp-feed-server.md, demonstrated: under Disconnect a gap should
  never be observed because the session is closed instead, and it wasn't.

--stall-after 5 --stall-duration 5, MockExchange__Feed__SlowConsumerPolicy=DropOldest:
  With --expect-drops:     Sequence gaps: 1  (108,875 records lost, expected under DropOldest)
                            Stall outcome: continued.  End reason: duration-elapsed.
  Without --expect-drops:  Sequence gaps: 1  (109,000 records lost)
                            RESULT: FAIL (exit 1) — same scenario, only the flag differs.
  Cross-checked against the server's own log for each run:
    "Feed session 416bc746... recovered under DropOldest; 108875 records were dropped" — exact match.
    "Feed session 0f17b413... recovered under DropOldest; 109000 records were dropped" — exact match.
  This is the strongest evidence available: the probe's independently-decoded gap size agrees with
  the exchange's own authoritative drop count to the record, across two separate runs.

Also verified: a raw refusal (8 sessions held open with plain sockets, then a probe as the 9th)
reports `refused: connection closed before a SessionStart frame arrived (server may be at
MaxSessions)` and exits 3 — not a crash, not a framing error, matching the coordinator's guidance.
A bad flag (`--bogus-flag`) prints usage to stderr and exits 64. `--help` prints usage and exits 0.
```

`dotnet build src/Tckr.slnx` and `dotnet test src/Tckr.slnx` both stay green (356 passed, 2 skipped,
0 failed — the exact baseline). One `dotnet test` run mid-session showed a single flaky failure in
`Generation/RandomWalkGeneratorTests.Generate_AllocatesNothing` (an allocation-threshold test in a
file this task does not own and never touched); it passed in isolation and on every subsequent full
run, and `git status` at the time showed a concurrent session mid-write across `src/`, matching the
coordinator's warning about task 06 finishing in parallel. Recorded here in case the flake recurs for
someone else — it is not this task's code.

### Deviation: price sanity is an observation, not an assertion against a "configured tick limit"

The brief asks for "any move exceeding the configured tick limit" per symbol. This task's own
dependency list is `01, 05` — not `02` (symbol universe) or `03` (price generation) — and the real
tick limit is two numbers this probe has no independent line of sight to: each symbol's `TickSize`
(from `Reference/symbols.json`, sized by whatever `--universe-size`/`UniverseSize` the server
happens to be running) and `Generation:MaxTickMove`. Depending on `Reference`/`Generation` to
recompute them would mean re-deriving the server's exact configuration out of band, which can drift
silently from the real run and produce false positives or negatives — worse than not checking at
all. `PriceSanity.perSymbol` instead reports, per symbol, the count, min, max and the largest single
observed step, with a `note` explaining why no threshold is applied. This is a report-only field —
it never affects the exit code — so it costs nothing to a passing run and gives a human or task 09
real numbers to compare against the server's own `appsettings.json` if they want to.

### Requests for files this task does not own

None. Everything needed — `FeedFrameReader`, `FeedRecord`, `FeedMessageType`, `PriceScale`,
`FeedFrameWriter`'s size constants — was already `internal` and reachable through the existing
`InternalsVisibleTo` entry. No change was requested of tasks 01, 05, 06 or 07.

### If I were deciding, not just implementing

Two things a coordinator should weigh, not silently baked in:

1. **The `--target-rate` default (25,000) is a guess about what task 09 will run.** It is correct
   for every benchmark this phase names, but if task 09 ever sweeps the rate (the README's own
   interview-value section implies achieved-vs-target is compared at more than one target), it will
   need to pass `--target-rate` explicitly rather than rely on the probe's default. Worth a line in
   task 09's own brief so it isn't rediscovered by a failing `%` line.
2. **A `--stall-after` run's own achieved-rate is not a meaningful PASS/FAIL signal**, and both
   verification runs above exited non-zero (`2`) purely because of it: the OS buffers a burst of
   already-arrived bytes during the pause, and draining that burst on resume happens far faster than
   real-time, inflating events-per-active-second well past +2%. The gap/EOF outcome is the real
   signal from a stall test, not the exit code. Task 09 should treat a `--stall-after` run as a
   qualitative check (gap vs. EOF, and the gap size) and not gate CI on its exit code the way it
   would a normal throughput run — I did not add a flag to suppress the rate check under
   `--stall-after` because doing so silently would hide a genuine rate regression that happened to
   coincide with a stall test; better to leave the exit code honest and document the caveat than to
   special-case it away.
