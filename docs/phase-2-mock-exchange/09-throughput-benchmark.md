# Task 09 — Throughput Benchmark & Report

| | |
|---|---|
| **Phase** | 2 — Mock Exchange |
| **Status** | Not started |
| **Depends on** | 06, 07, 08 |
| **Blocks** | Phase 4 |
| **Parallel with** | 10 |
| **Owns** | `benchmarks/phase-2/**` |

> **Scaffolding is already done.** The test project (`tests/Unit/Tckr.MockExchange.Tests`,
> xUnit + Shouldly + `FakeTimeProvider` + `MetricCollector`), the probe project
> (`tools/Tckr.FeedProbe`), both `InternalsVisibleTo` entries, the empty area folders under
> `src/Tckr.MockExchange/`, and the `src/Tckr.slnx` registrations all exist and build.
> Add your files into the existing structure; do not re-create projects or touch the
> solution file.

---

## Objective

Establish, with measurements rather than assertions, what the mock exchange can actually
deliver — and where it stops being able to.

---

## Why this matters

The master context is blunt about this:

> **Important:** These numbers must be actual measurements.

Phase 4 benchmarks ingestion against this load source. If the source tops out at 18K/sec
on the benchmark machine, then a Phase 4 result of "ingestion handled 18K/sec" says
nothing about ingestion. **We must know the ceiling of the instrument before trusting any
measurement taken with it.**

This task is also the honest one: if 25K/sec is not achievable on the available hardware,
that is the finding, and it gets written down along with what the ceiling actually is.

---

## Specification

### Environment capture

Record and publish, for every run:

- CPU model, physical/logical core count, base clock.
- RAM, OS and kernel version.
- .NET SDK and runtime version (`dotnet --info`).
- Build configuration — **Release only**; a Debug number is not a number.
- Server GC on/off, tiered compilation settings.
- Whether exchange and probe ran on the same host (they will, in Phase 2 — note the
  implication for the latency figures).
- Git commit SHA.

Script this into `benchmarks/phase-2/capture-env.sh` so it cannot be forgotten.

### Runs

Automate with `benchmarks/phase-2/run-benchmarks.sh`. Each run: 60 seconds steady state
after a 10-second warm-up that is excluded from the results.

| # | Scenario | Config | Question it answers |
|---|---|---|---|
| 1 | Baseline | 1,000/s, 1 consumer | Does pacing hold at trivial load? |
| 2 | Ramp | 5K / 10K / 25K/s, 1 consumer | Where does achieved diverge from target? |
| 3 | **Target** | 25,000/s, 1 consumer, 60 s | **The Phase 2 acceptance run.** |
| 4 | Headroom | 50K / 100K/s, 1 consumer | Where is the ceiling on this hardware? |
| 5 | Fan-out | 25,000/s, 1 / 2 / 4 / 8 consumers | How does publish cost scale with sessions? |
| 6 | Universe | 25,000/s, 50 / 250 / 1,000 / 10,000 symbols | Does universe size affect throughput? |
| 7 | Slow consumer | 25,000/s, 1 healthy + 1 stalled (`--stall-after 5`) | Does the healthy consumer stay unaffected? |
| 8 | Phases | `CompressedDay`, 5 min | Do phase multipliers show up in the achieved rate? |
| 9 | Soak | 25,000/s, 30 min | Any drift, leak, or degradation over time? |
| 10 | Determinism | Same seed, two runs, 10 s | Are the two tapes byte-identical? |

Vary configuration through environment variables (`MockExchange__Session__BaseEventsPerSecond`)
so no file is edited between runs.

### Metrics per run

From the probe (task 08) and the process itself:

- Target vs. achieved events/sec; achieved as a percentage of target.
- Sequence gaps and framing errors — **must be zero**.
- Inter-arrival jitter p50/p95/p99/max.
- Delivery latency p50/p95/p99/max.
- Wire throughput MB/sec.
- Process CPU % (whole process and the generation thread specifically).
- Working set and private memory, sampled every 5 s.
- GC: Gen0/1/2 collection counts, total allocated bytes, and max pause.
  Collect with `dotnet-counters collect --process-id <pid>`.
- ThreadPool queue length — a growing queue means the loop is starving the pool, which is
  the bug the dedicated thread in task 06 exists to prevent.

Note the GC counters explicitly. The Phase 2 target is **zero allocation per event in
steady state**; if Gen0 collections are occurring during a 60-second run at a steady rate,
something on the hot path is allocating and it needs finding before Phase 3 builds on it.

### Report

`benchmarks/phase-2/results.md`, structured as:

1. Environment (the capture above).
2. Summary table — one row per scenario, pass/fail against the target.
3. Per-scenario detail with the full metric set.
4. **The ceiling** — the highest rate sustained at ≥ 99% of target with zero gaps.
5. Observations and anomalies, written plainly.
6. Implications for Phase 3 and Phase 4 — specifically, the maximum rate at which
   ingestion benchmarks can be considered valid on this hardware.

Keep raw probe JSON under `benchmarks/phase-2/raw/` so results can be re-derived.

Headline table format:

```markdown
| Scenario | Target | Achieved | % | Gaps | p99 jitter | CPU | Gen2 | Result |
|---|---:|---:|---:|---:|---:|---:|---:|:--|
| Target 25K | 25,000/s | 24,986/s | 99.9% | 0 | 4.8 ms | 34% | 0 | PASS |
```

### Honesty rules

- Publish failures with the same prominence as successes. A scenario that did not reach
  target is a finding, not an embarrassment.
- Never publish a number produced by a Debug build.
- Never publish a single run as a result — three runs minimum, report median and spread.
- If exchange and probe share a host, state that the CPU figures include both.
- If the box thermally throttles during the soak, that goes in the report too.

---

## Acceptance criteria

- [ ] `capture-env.sh` and `run-benchmarks.sh` exist and are runnable end to end.
- [ ] All ten scenarios executed, three runs each, in Release.
- [ ] `results.md` published with real measured numbers and the environment recorded.
- [ ] Scenario 3 (25K/sec, 60 s) achieves ≥ 98% of target with zero sequence gaps, or the
      shortfall is documented with a diagnosis.
- [ ] Zero Gen2 collections during the target run; Gen0 rate reported.
- [ ] Determinism confirmed byte-for-byte (scenario 10).
- [ ] The hardware ceiling is stated explicitly.
- [ ] Raw probe output retained under `raw/`.

## Verification

```bash
./benchmarks/phase-2/capture-env.sh
./benchmarks/phase-2/run-benchmarks.sh
```

## Notes for other tasks
