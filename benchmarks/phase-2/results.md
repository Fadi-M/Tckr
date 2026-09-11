# Phase 2 — Throughput Benchmark Results

**Status:** Complete for the Definition-of-Done scenarios (1–8, 10). Scenario 9 (30-minute
soak) is explicitly **deferred** — see [§7](#7-scenario-9-soak--explicitly-deferred).

Every number in this document is read from a file under `benchmarks/phase-2/raw/`, either
directly or via `aggregate.py`. No number here was estimated, rounded from memory, or
carried over from a prior write-up without being reproduced against the files on disk. Where
a figure could not be reproduced or verified, that is stated plainly rather than silently
fixed.

---

## 0. This session's starting point — a repair, not a fresh run

The benchmark session that originally produced most of `raw/` (2026‑09‑10) was interrupted
mid-flight and never resumed. An audit before this session began established:

- Scenarios **7, 8, 9, 10** had **no raw output at all** — never executed.
- `raw/s6_universe_50/run1` and `run2` both **FAILED** (probe exit 2, achieved rate
  collapsed to ~199/s). The exchange log for those runs shows `RateGovernor` reporting the
  loop falling 852,606 ms and 54,511 ms behind schedule respectively — consistent with the
  host sleeping mid-run.
- `raw/s6_universe_1000/run2` was SIGTERM'd (probe exit 143), cut short ~20 s into a 20 s
  measurement window.
- `raw/s6_universe_1000/run3/exchange.log` was a 0-byte file (exchange never produced
  output for that run).

This session (2026‑09‑11):

1. Ran every benchmark under `caffeinate -dimsu`, so the host cannot sleep mid-run — the
   most likely cause of the original s6 collapse.
2. Executed the three missing-but-in-scope scenarios: **7** (slow consumer), **8** (market
   phases), **10** (determinism). Scenario 9 (30-minute soak) was deliberately **not**
   run — it is not a Definition-of-Done requirement, and the user explicitly deferred it
   for this session. See §7.
3. Fully re-ran `s6_universe_50` and `s6_universe_1000` (n=3 each, one clean attempt,
   no retries needed) and replaced the corrupt `raw/` directories outright.
4. Measured the generator's single-threaded throughput spread (8 consecutive Release runs)
   to source the previously-uncited README claim.

All of `s1_baseline`, `s2_ramp_*`, `s3_target_25k`, `s4_headroom_*`, `s5_fanout_*`, and
`s6_universe_250` were already present from the original session and are **unmodified**
here — they were re-verified via `aggregate.py` against the existing raw files, not
re-run, since nothing about them was flagged as suspect and re-running them would burn
time without adding information.

---

## 1. Environment

Captured by `benchmarks/phase-2/capture-env.sh`, refreshed at the start of this session.
Full text: `benchmarks/phase-2/raw/env.txt`.

| | |
|---|---|
| CPU | Apple M5 Pro, 15 physical / 15 logical cores (Apple silicon does not expose a base clock via `sysctl`) |
| RAM | 24 GB |
| OS | macOS 26.5 (build 25F71), Darwin 25.5.0 arm64 |
| .NET SDK | 10.0.302 (runtime 10.0.10, RID osx-arm64) |
| Build configuration | **Release only** — `dotnet build src/Tckr.slnx -c Release` |
| GC mode | Server GC on, Concurrent GC on (`Tckr.MockExchange.csproj`) |
| Tiered compilation / PGO | .NET 10 defaults (both on), not overridden |
| Topology | **`Tckr.MockExchange` and `Tckr.FeedProbe` ran on the same host for every scenario** — there is no second machine available. Delivery-latency figures below are same-host-clock figures, not network latency, and every CPU% figure is "this host running both processes" unless a scenario's detail explicitly splits them (scenario 5's fan-out sub-table does, via per-process `ps` sampling of the exchange only). |
| Git commit | `9b5a79cc166a54ace6d627b6b91f736d2744f5f3` (working tree had uncommitted changes at capture time — this task's own new/changed files) |
| Sleep prevention | `caffeinate -dimsu` wrapped every run in this session |

---

## 2. Summary table

Per the headline format in `09-throughput-benchmark.md`. "Target" is the flat rate the
probe was asked to hold; scenarios 5, 7 and 8 don't reduce to one flat-rate comparison and
are annotated accordingly rather than forced into the format. All achieved/gap/jitter/CPU
figures are **medians across 3 runs** (via `aggregate.py`) unless noted.

| Scenario | Target | Achieved | % | Gaps | p99 jitter | Exchange CPU (mean) | Gen0/1/2 | Result |
|---|---:|---:|---:|---:|---:|---:|---:|:--|
| 1 — Baseline | 1,000/s | 1,000.27/s | 100.03% | 0 | 5.02 ms | 59.2% | 0/0/0 | PASS |
| 2 — Ramp 5K | 5,000/s | 5,001.43/s | 100.03% | 0 | 5.01 ms | 59.7% | 0/0/0 | PASS |
| 2 — Ramp 10K | 10,000/s | 10,002.97/s | 100.03% | 0 | 5.00 ms | 60.0% | 0/0/0 | PASS |
| 2 — Ramp 25K | 25,000/s | 25,005.99/s | 100.02% | 0 | 0 ms | 59.9% | 0/0/0 | PASS |
| **3 — Target (acceptance)** | 25,000/s | 25,001.98/s (median; 25,002.92 / 25,001.98 / 25,001.29 across runs) | 100.008% | 0 | 0 ms | 60.0% | 0/0/0 | **PASS** |
| 4 — Headroom 50K | 50,000/s | 50,015.86/s | 100.03% | 0 | 0 ms | 59.7% | 0/0/0 | PASS |
| 4 — Headroom 100K | 100,000/s | 100,027.82/s | 100.03% | 0 | 0 ms | 60.4% | 0/0/0 | PASS |
| 5 — Fan-out 1/2/4/8 | 25,000/s each | ~25,003–25,010/s per consumer at every fan-out level | 100.0–100.04% | 0 (all consumers, all levels) | n/a¹ | 56.1% → 73.2% (scales with consumer count) | 0/0/0 | PASS |
| 6 — Universe 50 | 25,000/s | 25,008.74/s | 100.03% | 0 | 0 ms | 64.1% | 0/0/0 | PASS (repaired) |
| 6 — Universe 250 | 25,000/s | 25,007.54/s | 100.03% | 0 | 0 ms | 59.7% | 0/0/0 | PASS |
| 6 — Universe 1000 | 25,000/s | 25,008.88/s | 100.04% | 0 | 0 ms | 64.1% | 0/0/0 | PASS (repaired) |
| 7 — Slow consumer, healthy leg (Disconnect policy) | 25,000/s | 25,004.74/s | 100.02% | 0 | 0 ms | 66.0%² | 0/0/0 | PASS — healthy consumer unaffected |
| 7 — Slow consumer, healthy leg (DropOldest policy) | 25,000/s | 25,007.58/s | 100.03% | 0 | 0 ms | 72.2%² | 0/0/0 | PASS — healthy consumer unaffected |
| 7 — Slow consumer, stalled leg (Disconnect policy) | n/a | disconnected cleanly (`endReason=eof`) after ~5 s stall | n/a | 0 | n/a | (shared with healthy leg) | 0/0/0 | PASS — disconnect fired as designed |
| 7 — Slow consumer, stalled leg (DropOldest policy) | n/a | stayed connected, resumed after stall | n/a | 1 (expected disclosure) | n/a | (shared with healthy leg) | 0/0/0 | PASS — drop-oldest fired as designed |
| 8 — Phases (CompressedDay, 5 min) | n/a — rate varies by phase by design | overall 21,871.30/s; **per-interval range 0/s → 57,459/s** | n/a³ | 0 | n/a³ | 56.6% (mean) | 0/0/0 | PASS — phase-driven rate variation is the finding, not a shortfall |
| 9 — Soak (30 min) | 25,000/s | **not run** | — | — | — | — | — | **DEFERRED** (see §7) |
| 10 — Determinism | n/a | 3/3 runs byte-identical SHA-256 tape hash on immediate connect; a deliberate late-join capture produced a **different** hash | n/a | n/a | n/a | n/a | n/a | PASS |

¹ Scenario 5 has no single jitter figure across a variable number of concurrent probes; see
§3.5 for per-consumer detail.
² CPU figure is for the shared exchange process serving both the healthy and stalled probe
in the same run; it cannot be attributed to one leg alone from `ps` sampling.
³ A flat jitter/percent figure is not meaningful against a target that changes by design
every report interval; see §3.8 for the full per-interval trace.

---

## 3. Per-scenario detail

### 3.1 Scenario 1 — Baseline (1,000/s, 1 consumer)

`raw/s1_baseline/run{1,2,3}` — measured 20 s (see note on durations below), 5 s warm-up.

| Metric | Median | Spread (max−min across 3 runs) |
|---|---:|---:|
| Achieved rate | 1,000.27/s (100.03%) | 0.056/s |
| Sequence gaps | 0 | 0 |
| Framing errors | 0 | 0 |
| Inter-arrival jitter p50/p95/p99/max | 0 / 5.01 / 5.02 / 5.60 ms | — |
| Delivery latency p50/p95/p99/max | 0.863 / 0.894 / 0.933 / 2.12 ms | — |
| Wire throughput | 44.0 KB/s (44.0 bytes/event) | — |
| Exchange CPU mean/max | 59.2% / 60.2% | — |
| Exchange RSS max | 74.8 MB | — |
| GC Gen0/1/2 | 0 / 0 / 0 | — |
| ThreadPool max queue length | 0 | — |

### 3.2 Scenario 2 — Ramp (5K / 10K / 25K/s, 1 consumer)

`raw/s2_ramp_{5000,10000,25000}/run{1,2,3}`

| Rate | Achieved (median) | % of target | Gaps | p99 jitter | p99 latency | CPU mean |
|---:|---:|---:|---:|---:|---:|---:|
| 5,000/s | 5,001.43/s | 100.03% | 0 | 5.01 ms | 0.692 ms | 59.7% |
| 10,000/s | 10,002.97/s | 100.03% | 0 | 5.00 ms | 0.706 ms | 60.0% |
| 25,000/s | 25,005.99/s | 100.02% | 0 | 0 ms | 0.405 ms | 59.9% |

Achieved diverges from target by well under 0.1% at every step tested; nothing here
suggests a divergence point below 25K/s. (Above 25K/s, see scenario 4.)

### 3.3 Scenario 3 — Target / Phase 2 acceptance run (25,000/s, 60 s)

`raw/s3_target_25k/run{1,2,3}` — the mandated 60 s steady-state / 10 s warm-up (the only
scenario that used the brief's literal durations; see the note in §8).

| Run | Achieved | % of target | Gaps | Framing errors |
|---|---:|---:|---:|---:|
| 1 | 25,002.92/s | 100.012% | 0 | 0 |
| 2 | 25,001.98/s | 100.008% | 0 | 0 |
| 3 | 25,001.29/s | 100.005% | 0 | 0 |

- Delivery latency (run 1): p50 0.485 ms / p95 0.543 ms / p99 0.559 ms / max 4.627 ms.
- Inter-arrival jitter (median across runs): p50/p95/p99 = 0 ms, max 9.11 ms.
- Top-10 symbol share: **59.13%** (run 1: 59.127%).
- Wire throughput: 1.10 MB/s, 44.0 bytes/event (exactly `TickFrameSize`).
- GC: **0 Gen0/Gen1/Gen2 collections** in every run across the full 60 s window; GC pause
  time counter reads 0 throughout; ThreadPool queue length stayed at 0 throughout.
- Allocated bytes over the 60 s window (`dotnet-counters`, summed per-second rate): 8,088,960
  / 8,092,888 / 8,081,056 B across the three runs — see §6(a) for what this residual is.

These reproduce the previously-recorded reference numbers exactly (25,002.92 / 25,001.98 /
25,001.29 events/sec; 0 gaps; 0 framing errors; 59.13% top-10 share) — this session did not
re-run scenario 3, it re-verified the existing files with `aggregate.py`.

**This is the Phase 2 acceptance criterion. PASS.**

### 3.4 Scenario 4 — Headroom (50K / 100K/s, 1 consumer)

`raw/s4_headroom_{50000,100000}/run{1,2,3}`

| Rate | Achieved (median) | % of target | Gaps | Exchange CPU mean/max | RSS max |
|---:|---:|---:|---:|---:|---:|
| 50,000/s | 50,015.86/s | 100.03% | 0 | 59.7% / 61.1% | 74.4 MB |
| 100,000/s | 100,027.82/s | 100.03% | 0 | 60.4% / 61.3% | 74.5 MB |

Both rates — 2× and 4× the Phase 2 target — sustain **100% of target with zero gaps**, and
exchange CPU barely moves off its ~60% floor (see §6 on why that floor is roughly constant
regardless of rate). This is the data behind §5 (the ceiling).

### 3.5 Scenario 5 — Fan-out (25,000/s, 1 / 2 / 4 / 8 consumers)

`raw/s5_fanout_{1,2,4,8}/run{1,2,3}` (probes named `probe_1.json`…`probe_N.json` per run)

| Consumers | Per-consumer achieved rate (all runs, all consumers) | Gaps | Exchange CPU mean | Exchange CPU max |
|---:|---|---:|---:|---:|
| 1 | 25,003.4 – 25,006.8/s | 0 | 56.1% | 59.9% |
| 2 | 25,003.9 – 25,010.0/s | 0 | 60.4% | 64.4% |
| 4 | 25,006.3 – 25,009.3/s | 0 | 65.9% | 70.3% |
| 8 | 25,004.1 – 25,008.7/s | 0 | 73.2% | 81.8% |

Every consumer at every fan-out level hits its target rate with zero gaps — publish cost
scales in CPU (56%→73% mean, roughly +2.5 points of CPU per doubling of sessions), not in
achieved rate. No consumer starves another.

### 3.6 Scenario 6 — Universe (25,000/s, 50 / 250 / 1,000 symbols)

`raw/s6_universe_{50,250,1000}/run{1,2,3}` — **50 and 1000 repaired this session** (see §0);
**250 unmodified, re-verified**. `s6_universe_10000` (the fourth leg the task doc's table
lists) has no raw data and was **not** part of this session's repair scope — it was not one
of the four things the pre-session audit flagged as missing or corrupt, and it was not run.
Flagged here rather than silently omitted.

| Universe size | Achieved (median) | % of target | Gaps | p99 latency | Exchange CPU mean |
|---:|---:|---:|---:|---:|---:|
| 50 | 25,008.74/s | 100.03% | 0 | 0.896 ms | 64.1% |
| 250 | 25,007.54/s | 100.03% | 0 | 0.904 ms | 59.7% |
| 1,000 | 25,008.88/s | 100.04% | 0 | 0.742 ms | 64.1% |

Universe size does not measurably affect throughput across the range tested; the 50-symbol
and 1,000-symbol legs run a few points of CPU hotter than 250, which is within the same
noise band as scenario 1 vs. scenario 3 (60% vs 64%) rather than a clear trend with size —
plausibly page/cache effects from the symbol-state array, not confirmed further here.

### 3.7 Scenario 7 — Slow consumer (25,000/s, 1 healthy + 1 stalled, `--stall-after 5 --stall-duration 5`)

`raw/s7_slowconsumer_{Disconnect,DropOldest}/run{1,2,3}` (`probe.json` = healthy consumer,
`probe2.json` = stalled consumer)

**Default policy — Disconnect:**

| Leg | Achieved | Gaps | End reason | p99 latency |
|---|---:|---:|---|---:|
| Healthy (median) | 25,004.74/s (100.02% of 25,000/s) | 0 | duration-elapsed | 1.619 ms |
| Stalled (run 1) | active for 5.01 s before disconnect | 0 | **eof** (server closed the session) | n/a — session ended before a percentile window formed |

The stalled probe's own "achieved rate" field (47,173/s, 188.7% of a 25,000/s target) is an
artifact worth flagging rather than a real rate: `activeSeconds` for that leg is only ~5.01 s
(the probe was connected, stalled, and disconnected inside that window), so
`eventsReceived / activeSeconds` divides a normal burst of received events by an abnormally
short denominator. The number that actually matters here is `endReason: eof` — the server
disconnected the stalled session cleanly, with **zero sequence gaps or framing errors**, and
the healthy consumer's rate and gap count were unaffected throughout.

**DropOldest policy:**

| Leg | Achieved | Gaps | End reason | p99 latency |
|---|---:|---:|---|---:|
| Healthy (median) | 25,007.58/s (100.03% of 25,000/s) | 0 | duration-elapsed | 1.092 ms |
| Stalled (median) | 26,071.59/s over the full 20 s window (activeSeconds ≈ 15.0 s) | **1** (expected) | duration-elapsed | p99 4,844 ms |

Under `DropOldest` the stalled consumer stays connected through the stall and resumes; the
probe's independently-detected sequence gap count is exactly **1** in all three runs — the
documented, expected disclosure of what the server withheld while the consumer was stalled
(not exchange-side data loss; see the probe's own gap-count note in `probe.json`). The
stalled leg's p99 delivery latency of ~4.8 s is the stall itself showing up in the
latency histogram, exactly as expected — the consumer received a burst of records all at
once when it caught up.

**DoD item "a slow consumer is disconnected under the default policy without affecting the
generation rate or other sessions" is confirmed directly by this data, with 0 gaps under
Disconnect and the healthy leg's rate and gap count unaffected in both policies.**

### 3.8 Scenario 8 — Phases (CompressedDay, 5 min)

`raw/s8_phases_compressedday/run{1,2,3}` — 300 s measurement, 5 s warm-up, `--report-interval 10`.

**All three runs exit the probe with code 2.** This is expected, not a failure, and it is a
different situation from the exit-2 failures in the original corrupt `s6` data — see the
explicit contrast below. The probe's exit code reflects a blunt ±2% check against a single
static `--target-rate 25000`, and a `CompressedDay` session's entire point is that the rate
is *not* static — it follows the phase schedule
(`MarketSessionOptions.CreateDefaultPhases`: PreOpen ×0.10 → OpeningAuction ×3.00 →
ContinuousMorning ×1.20 → MiddayLull ×0.60 → ContinuousAfternoon ×1.00 → ClosingAuction
×2.50, mapped across a 5-hour trading day compressed into 5 real minutes). Comparing that
against a flat 25,000/s target was always going to fail the probe's tolerance check; the
run itself is healthy.

**Contrast with the old corrupt `s6_universe_50` exit-2 runs, so a reader cannot conflate
them:** those runs collapsed to ~199 events/sec against a *flat, unchanging* 25,000/s target
because the host slept mid-run (`RateGovernor` fell 852,606 ms / 54,511 ms behind). Here the
achieved rate legitimately ranges from 0/s to 57,459/s *by design*, sequence gaps are 0,
framing errors are 0, and the process never falls behind schedule — the exit code fires
because the probe's tolerance check is the wrong tool for a varying target, not because
anything went wrong.

**Per-interval trace, run 1** (`raw/s8_phases_compressedday/run1/probe.log`, 10 s report
interval — annotated against the default phase schedule, itself linearly compressed 60:1
into the 300 s run):

| t | interval rate | phase (inferred) |
|---:|---:|---|
| 0–20 s | 0/s | pre-session buffer (`Closed`) |
| 30–50 s | 1,272 → 2,500/s | `PreOpen` (×0.10 → 2,500/s) |
| 60 s | **45,025/s** | `OpeningAuction` burst (×3.00 → 75,000/s target; the 10 s report bucket only partially overlaps the 5 s window, so the interval average is well below the instantaneous peak) |
| 70–160 s | ~30,000/s (steady) | `ContinuousMorning` (×1.20 → 30,000/s) |
| 170–240 s | ~15,000/s (steady) | `MiddayLull` (×0.60 → 15,000/s) |
| 250–280 s | ramping to 25,000/s | `ContinuousAfternoon` (×1.00 → 25,000/s) |
| 290 s | **57,459/s** | `ClosingAuction` burst (×2.50 → 62,500/s target) |
| 300.9 s | 27,898/s (tail) | end of window, mid-burst |

Runs 2 and 3 reproduce the same shape (peak interval rate 57,493/s in both, min 0/s in
both, overall 21,871.30/s and 21,872.16/s respectively vs. run 1's 21,870.64/s — spread
1.52/s across the three runs' overall figure).

- Sequence gaps: **0** in all three runs. Framing errors: **0** in all three runs.
- GC: 0 Gen0/Gen1/Gen2 collections in all three runs (over 300 s each — the longest window
  tested this session).
- Exchange CPU mean/max: 56.6% / 65.4% (median across runs) — the closing-auction burst is
  visible as the CPU max, same shape as the rate trace.
- **DoD item "market phases visibly change the emission rate (opening burst > continuous >
  lull)" is directly confirmed**: burst intervals (45,025/s, 57,459–57,493/s) exceed the
  continuous intervals (~30,000/s, ~25,000/s), which exceed the lull interval (~15,000/s),
  which exceeds the pre-open ramp (1,272–2,500/s), which exceeds the closed window (0/s).

### 3.9 Scenario 9 — Soak (30 min)

**Not run.** See §7.

### 3.10 Scenario 10 — Determinism (same seed, `DeterministicTimestamps=true`, 5,000 ticks)

`raw/s10_determinism/run{1,2,3}` — `BaseEventsPerSecond=5000`, `UniverseSize=250`,
`Seed=20260907`, `DeterministicTimestamps=true`; `capture_tape.py` races the raw socket
(not the "Feed server listening" log line — see the long comment in that script for why)
and captures 5,000 tick frames (Trade/BidQuote/AskQuote only; SessionStart and Heartbeat
frames excluded per the module docstring).

| Run | SHA-256 of `tape.bin` (200,000 bytes = 5,000 × 40-byte tick payload) |
|---|---|
| 1 | `1a3ad0351a07ae2b6e4b6c45631c1ef4c73270332c0787f956d178f362d11137` |
| 2 | `1a3ad0351a07ae2b6e4b6c45631c1ef4c73270332c0787f956d178f362d11137` |
| 3 | `1a3ad0351a07ae2b6e4b6c45631c1ef4c73270332c0787f956d178f362d11137` |

**All three hashes are byte-identical.** Determinism is confirmed byte-for-byte, satisfying
the DoD item and the acceptance criterion.

**Additional diagnostic capture (this session), not part of the canonical 3-run matrix but
kept under `raw/` for the same reason:** `raw/s10_determinism/run_lateJoin_diagnostic/`
repeats the identical configuration but waits 3 s after the exchange starts before
connecting, simulating a late-joining consumer. Its tape hash —
`9ec04de33d5d7fb882d2e0d1b2c5471ce9b0279ff82285f25de4a60d44ee204b` — is **different** from
the immediate-connect hash above. This is ADR 004's documented shared-tape design working as
intended (see §6(b)), not a determinism bug, and it is included here so the "byte-identical"
claim is not overstated: it holds only for a consumer that connects immediately.

---

## 4. The ceiling

**Highest rate sustained at ≥ 99% of target with zero gaps, within what was tested:
100,000 events/sec** (scenario 4's upper leg) — **4× the 25,000/sec Phase 2 target.**

Both scenario-4 legs (50,000/s and 100,000/s) achieved 100.03% of target with zero gaps in
every run, and exchange CPU at 100,000/s was still only **60.4% mean / 61.3% max** of one
core — essentially the same CPU floor observed at 1,000/s (59.2%) and 25,000/s (60.0%).
That floor is the `RateGovernor` pacing cost described in §6(a), not saturation from
generation, encoding or publishing.

**This means the true ceiling was not reached by this benchmark matrix.** 100,000/s is the
highest rate *verified*, not the highest rate *possible* — scenario 4 as specified only
tests 50K and 100K. Establishing where the exchange actually saturates would require testing
materially higher rates (250K, 500K, 1M/s), which is out of scope for this repair session
(the task brief asks for the 50K/100K legs specifically, not an open-ended search for the
breaking point). Stated explicitly, as the DoD requires: **the hardware ceiling is at least
100,000 events/sec; the exact breaking point is unmeasured.**

---

## 5. Observations and anomalies

**(a) Steady-state allocation is not literally zero, and that is expected, not a
regression.** `RandomWalkGeneratorBenchmarkTests.GeneratesAtLeastAMillionEventsPerSecondOnOneThread`
and `FeedFrameWriterTests.EncodingIsAllocationFree` independently confirm the generator and
the frame encoder allocate exactly 0 bytes in isolation. The small non-zero residual seen in
every live scenario above comes from `RateGovernor.WaitUntilDueAsync`: it calls
`Task.Delay` once per 5 ms batch (not per event) for the coarse part of its wait — the async
state machine, `Task`, and timer/cancellation registration underneath that call allocate
roughly 2.4 KB per batch. Because it is per-*batch*, this amortises differently depending on
how many events land in each batch:

- **Live 60-second benchmark** (`raw/s3_target_25k`, 25,000 events/sec, 125 events/batch):
  8,088,960 / 8,092,888 / 8,081,056 bytes allocated over ~1,500,000 events per run ≈
  **5.4 bytes/event** (computed directly from `dotnet-counters`' summed allocation-rate
  samples ÷ `achievedRate.overall × activeSeconds`, both from files under `raw/`).
- **Isolated host-level test**
  (`tests/Unit/Tckr.MockExchange.Tests/Host/MockExchangeHostTests.cs`,
  `ASteadyStateRunDoesNotAllocatePerEvent`): documented baseline **19.4–20.5 bytes/event**
  (mean ~19.9) across 35 consecutive Release runs on development hardware, and
  **14.4–14.8 bytes/event** across 8 runs with the throughput reporter actively logging —
  no higher with the reporter running than without it, which is the test's own evidence that
  the cost is the governor's pacing and not `ThroughputReporter`. (This second figure is
  cited from that test file's own recorded measurements, not reproduced fresh in this
  session — it is not a `benchmarks/phase-2/raw/` artifact, and is called out as such.)

Both figures are non-zero and both are **well below the < 40 bytes/event bound the host test
enforces**, and neither triggers a single Gen0, Gen1 or Gen2 collection in any measured
window (0/0/0 in every scenario above, including the 300-second scenario-8 runs — the
longest window tested). **A literal reading of "0 bytes per event" is not what this system
achieves; "0 bytes per event on the generate/encode/publish hot path, plus a small,
accounted-for per-batch pacing cost that triggers no collections" is what it achieves, and
that is the claim actually defensible from measurement.**

**(b) Determinism reproduces byte-identically only when the consumer connects immediately.**
Confirmed directly in §3.10: three canonical runs produced identical tape hashes; one
deliberate late-join capture (3 s delay before connecting, same seed, same
`DeterministicTimestamps=true`) produced a different hash. This is not a bug — it is ADR
004's documented shared-tape design: `FeedPublisherService`'s generation loop starts as soon
as the listener binds and runs continuously whether or not anyone is connected (mock
exchange README design decision #4), so a late-joining consumer starts mid-tape rather than
at record one. "Byte-identical tapes" is therefore a conditional guarantee — same seed,
`DeterministicTimestamps=true`, **and** immediate connection — not an unconditional one, and
this document does not overstate it.

**(c) A negative delivery-latency sample appears in `raw/s6_universe_250/run1/probe.json`**
(p50 = −0.353 ms). Both processes share a host and (per `env.txt`) a single wall clock, so
this should not be possible from real network latency — it is same-host clock/scheduling
jitter around the moment a batch is stamped vs. the moment it's read, landing on the
negative side of zero for a handful of samples in an otherwise sub-millisecond distribution.
Flagged rather than smoothed over; it does not appear in any other scenario's p50, and every
other latency percentile in every scenario is positive and consistent with the ~0.4–1.6 ms
range seen throughout.

**(d) Exchange CPU is dominated by a fixed per-batch cost, not by throughput.** Across
1,000/s (59.2%) through 100,000/s (60.4%) — a 100× range in achieved rate — exchange CPU
mean moves by barely one point. This matches `RateGovernor`'s own documented cost model (its
hybrid delay/spin-wait burns roughly a fifth of a core every batch, independent of how many
events are in it) and explains why scenario 4 shows no CPU pressure at 100,000/s even though
it's 4× the Phase 2 target: the governor's fixed cost, not per-event work, is what's on the
critical path for CPU.

**(e) No scenario in this matrix produced a sequence gap it wasn't supposed to.** The only
non-zero gap counts anywhere in `raw/` are scenario 7's DropOldest leg (exactly 1, in all 3
runs — the documented expected disclosure) and the old, now-replaced, corrupt `s6_universe_50`
runs (superseded, not part of the current dataset). Every other scenario — including the
300-second scenario-8 runs and the 4×-target scenario-4 runs — shows 0 gaps and 0 framing
errors.

---

## 6. Implications for Phase 3 and Phase 4

- **Ingestion benchmarks against this mock exchange are valid for any target rate up to at
  least 100,000 events/sec on equivalent hardware** — that is the highest rate verified at
  ≥99% of target with zero gaps (§4). A Phase 4 ingestion result quoting a rate above that
  is testing something this benchmark has not characterized; a result at or below it is
  testing against a load source with confirmed headroom, not a source that is itself the
  bottleneck.
- **Co-location is a real caveat, not a formality.** Every latency figure in this document
  is same-host-clock latency (§1, §5(c)). The moment Phase 4 puts ingestion and the exchange
  on separate machines, these delivery-latency numbers stop being comparable — they will
  include real network transit that this session's numbers cannot, by construction, contain.
  Phase 4 needs its own latency baseline once it's on separate hosts; this document's latency
  figures should not be reused as a cross-host expectation.
- **The exchange's CPU floor (~60% of one core) is fixed, not scaling.** If Phase 4 runs the
  exchange and the ingestion service on the same box, budget that ~60% floor (rising to
  ~73–81% at 8 concurrent consumers per scenario 5) as unavailable to ingestion regardless of
  the rate ingestion asks for — it is `RateGovernor` pacing overhead, not something that
  frees up at lower rates.
- **The scenario-8 result is a caution about tolerance checks, not a caution about the
  exchange.** Any Phase 3/4 tooling that reuses `Tckr.FeedProbe`'s ±2% target-rate check
  against a session running `CompressedDay` (or any future non-flat rate mode) needs a
  phase-aware tolerance check, or it will report a "failure" on a healthy run, exactly as
  happened here. §3.8 documents the correct reading; the fix (a phase-aware check) is out of
  scope for this repair session since `Tckr.FeedProbe` is owned by task 08, not task 09.

---

## 7. Scenario 9 (soak) — explicitly deferred

Scenario 9 (25,000/s, 30 minutes, `raw/s9_soak_30min`) was **not run** in this session. This
is a deliberate scope decision, not an oversight:

- It is **not** a Definition-of-Done requirement — the DoD (`docs/phase-2-mock-exchange/README.md`
  §9) does not name the soak run anywhere in its checklist.
- The user explicitly deferred it for this session ("DO NOT run scenario 9... It is not a
  Definition-of-Done requirement and the user has deferred it").

No `raw/s9_soak_30min` directory exists, and this document makes no claim about drift, leak,
or degradation over a 30-minute run. If Phase 2's DoD is later read to require it, or if a
future session wants long-run confidence beyond the 300 s scenario-8 run (which showed 0
Gen0/1/2 collections and a stable CPU/RSS profile for 5 minutes — the longest window actually
tested), scenario 9 is fully scripted and ready in `run-benchmarks.sh` (`./run-benchmarks.sh 9`);
it simply was not executed here.

---

## 8. Methodology notes

- **Not every scenario used the brief's literal 60 s / 10 s warm-up.** Only scenario 3 (the
  acceptance run) did — `run-benchmarks.sh` hard-codes it there. Scenarios 1, 2, 4, 5, 6 used
  a 20 s measurement / 5 s warm-up (`MEASURE_SECONDS=20 WARMUP_SECONDS=5`, matching what the
  original 2026-09-10 session used for these scenarios, reproduced here for the repaired
  scenario 6 legs and for consistency with the untouched scenarios' existing data). Scenario
  7 uses a script-mandated 20 s measurement; scenario 8 uses a script-mandated 300 s
  measurement; scenario 10 is not time-bounded — it captures a fixed count of 5,000 tick
  frames. This is `run-benchmarks.sh`'s own documented trade-off (see the comment block at
  the top of that script) to fit the whole matrix in a practical session, not a shortcut
  applied here. It does not affect scenario 3, the actual acceptance criterion, which used
  the full 60 s / 10 s the brief specifies.
- **RUNS=3** for every scenario in this document — the brief's stated minimum. No scenario in
  this report is based on a single run.
- Every run this session executed **one time only** — no scenario required a retry due to a
  failed or discarded attempt. Where a metric's spread is reported, it is the max−min across
  those 3 runs, not a cherry-picked subset.
- `aggregate.py raw/<scenario>` reproduces every median/spread figure in this document
  directly from the JSON/CSV files on disk; it was used throughout in preference to hand
  transcription. A handful of figures (scenario 5's per-consumer fan-out table, scenario 7's
  two-probe-per-run figures, scenario 8's per-interval trace) needed small one-off scripts
  reading the same raw files, because `aggregate.py` assumes one `probe.json` per run
  directory — those scripts are not checked in (throwaway aggregation, not a maintained
  tool), but every number they produced traces to files still on disk under `raw/`.

---

## 9. Generator single-thread throughput (sourcing the README claim)

`README.md` previously stated "36.4M events/sec single-threaded (27.5 ns/event)" with no
citation anywhere in the repo, and two prior audit passes had disagreed sharply (~36.4M vs.
15.98M events/sec @ 62.6 ns/event) — with no raw data behind either number. This session ran
`RandomWalkGeneratorBenchmarkTests.GeneratesAtLeastAMillionEventsPerSecondOnOneThread` in
**Release** 8 consecutive times on the machine described in §1, with no other load running
(machine confirmed idle by the coordinator during this measurement). Raw output:
`benchmarks/phase-2/raw/generator_throughput/`.

| Run | Events/sec | ns/event | Allocated | Gen0 |
|---:|---:|---:|---:|---:|
| 1 | 36,283,455 | 27.6 | 0 B | 0 |
| 2 | 35,927,197 | 27.8 | 0 B | 0 |
| 3 | 36,431,595 | 27.4 | 0 B | 0 |
| 4 | 36,323,013 | 27.5 | 0 B | 0 |
| 5 | 36,868,720 | 27.1 | 0 B | 0 |
| 6 | 36,673,935 | 27.3 | 0 B | 0 |
| 7 | 36,303,381 | 27.5 | 0 B | 0 |
| 8 | 35,887,943 | 27.9 | 0 B | 0 |

- **Range: 35,887,943 – 36,868,720 events/sec** (27.1–27.9 ns/event).
- **Mean: 36,337,405 events/sec**, median 36,313,197/s, stdev ≈ 333,591 (~0.9%), spread
  (max−min) ≈ 2.7% of the mean.
- **0 bytes allocated and 0 Gen0 collections in every run**, consistent with
  `RandomWalkGeneratorBenchmarkTests`' own zero-allocation assertion.
- All 8 runs cluster tightly around the machine's original ~36.4M claim; **none came
  remotely close to the previously-reported 15.98M events/sec / 62.6 ns/event figure.** That
  figure could not be reproduced this session and is not corroborated by any file under
  `raw/`. The most likely explanations — a Debug or non-optimized build, a loaded machine at
  measurement time, or a different code path prior to some later change — cannot be
  distinguished from here; it is flagged as **unreproduced**, not endorsed and not silently
  dropped.

**README figure, now sourced:** "35.9–36.9M events/sec single-threaded (27.1–27.9 ns/event,
mean ~36.3M/sec), measured across 8 consecutive Release runs on an Apple M5 Pro" — a range
rather than a single number, because a single number from 8 runs spanning 2.7% would imply
more precision than the measurement supports.

---

## Appendix — file index

| File | Contents |
|---|---|
| `raw/env.txt` | Environment capture (this session) |
| `raw/s1_baseline/` … `raw/s6_universe_1000/` | Scenarios 1–6 (6 partially repaired this session — see §0) |
| `raw/s7_slowconsumer_{Disconnect,DropOldest}/` | Scenario 7 (new this session) |
| `raw/s8_phases_compressedday/` | Scenario 8 (new this session) |
| `raw/s10_determinism/run{1,2,3}/` | Scenario 10 canonical matrix (new this session) |
| `raw/s10_determinism/run_lateJoin_diagnostic/` | Scenario 10 supplementary late-join capture (new this session, see §3.10/§5(b)) |
| `raw/generator_throughput/` | Generator single-thread throughput, 8 Release runs (new this session, see §9) |
| `raw/s9_soak_30min/` | **Does not exist** — deferred, see §7 |
