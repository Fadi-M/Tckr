# Task 09 — Throughput Benchmark & Report

| | |
|---|---|
| **Phase** | 2 — Mock Exchange |
| **Status** | Done — see [`benchmarks/phase-2/results.md`](../../benchmarks/phase-2/results.md): scenarios 1–8 and 10 executed (n=3 each) under `caffeinate`, scenario-6 corruption from the original interrupted session repaired, generator-throughput README claim sourced; scenario 9 (30-min soak) explicitly deferred, not a DoD item |
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

### Inbound requests from completed tasks

**From task 06 — the configuration keys are not the ones in the task briefs.** Task 06 kept the
property names the completed components were built and tested against rather than the names in its
own brief's example JSON, so a sweep script written from that JSON would set keys that bind to
nothing and change nothing — silently, because an unmatched configuration key is not an error.
The keys that exist:

| Setting | Key |
|---|---|
| Target rate | `MockExchange__Session__BaseEventsPerSecond` |
| Rate ceiling | `MockExchange__Session__MaxEventsPerSecond` |
| Batch interval | `MockExchange__Session__BatchIntervalMs` |
| Session mode | `MockExchange__Session__Mode` |
| Run seed | `MockExchange__Generation__Seed` |
| Universe size | `MockExchange__Generation__UniverseSize` |
| Message mix | `MockExchange__Generation__TradeShare` / `BidQuoteShare` / `AskQuoteShare` |
| Price band | `MockExchange__Generation__DailyBandBasisPoints` |
| Identical tapes | `MockExchange__Generation__DeterministicTimestamps` |
| Listen port | `MockExchange__Feed__Port` |
| Status interval | `MockExchange__Diagnostics__ThroughputReportIntervalSeconds` |

Three of these are worth calling out. There is **no root `Seed`**, and no `0 = random` rule: the
seed lives under `Generation` because the universe and the walk that runs on it are one
reproducibility unit, and `0` is a legitimate seed the RNG has a test for, so overloading it to
mean "pick one" would have made the start-up line report a seed that was not the seed configured.
The mix is expressed as **shares, not ratios summing to 1.0** — they are normalised, so `4/3/3` and
`0.4/0.3/0.3` are the same tape; a sum other than 1.0 is legal and produces a start-up warning
naming what it resolved to. And the price band is `DailyBandBasisPoints` (1,000 = ±10%), not
`DailyPriceBandPercent`.

**From task 06 — verified, not assumed.** The environment-variable override path has a test
(`AnEnvironmentVariableOverridesTheBoundOptions`), and a Release run on Apple silicon held
`target=25000/s achieved=25000/s (100.0%)` with `lag_p99=0.0ms`, `dropped=0` across a live consumer
connecting and leaving. Read those numbers from `FeedMetrics` as task 07's notes describe rather
than recomputing them.

**From task 03 — which clock a run uses, decided.** `GenerationOptions.DeterministicTimestamps`
(default `false`) swaps the wall clock for a synthetic one with a fixed epoch and a fixed step.
The two kinds of run want opposite settings, so pick per run and say which in the report:

| Run | Setting | Why |
|---|---|---|
| Throughput and latency | `false` (default) | A synthetic clock fabricates the exact quantity being measured. Never benchmark against it. |
| Tape identity across phases | `true` | Makes "same seed, byte-identical tape" literally true, so the check is a file hash rather than a field-by-field comparison that masks the one field most likely to differ. |

Do **not** implement tape comparison by masking the timestamp field. Masking is a convention
that has to be re-remembered at every comparison site, and it quietly degrades into "we compared
everything except the field most likely to differ." The flag exists so the claim can stay strong.

**From task 07 — read the achieved rate from the meter, not from your own counters.**
`mockexchange.rate.achieved` is a rolling 5 s window, deliberately not a since-startup average,
because an average hides a mid-run collapse. If the benchmark computes its own mean over the whole
run it will reintroduce exactly the blindness task 07 removed. Report both if you like, but the
rolling figure is the one that can fail a run.

---

## Acceptance criteria

- [x] `capture-env.sh` and `run-benchmarks.sh` exist and are runnable end to end.
- [x] Nine of ten scenarios executed, three runs each, in Release (1–8, 10). Scenario 9
      (30-minute soak) is **not** executed — it is not a Definition-of-Done item, and was
      explicitly deferred for this session; see `results.md` §7. This checkbox is honestly
      partial rather than ticked as if all ten ran.
- [x] `results.md` published with real measured numbers and the environment recorded
      (`benchmarks/phase-2/results.md`, §1 environment, every other section sourced from
      `raw/`).
- [x] Scenario 3 (25K/sec, 60 s) achieves ≥ 98% of target with zero sequence gaps — measured
      100.005–100.012% across 3 runs, 0 gaps, 0 framing errors in all three
      (`raw/s3_target_25k/run{1,2,3}`).
- [x] Zero Gen2 collections during the target run; Gen0 rate reported — 0 Gen0/Gen1/Gen2 in
      every scenario-3 run; the small non-zero per-batch allocation residual (not
      per-event) is reported and explained in `results.md` §5(a) and §6, not hidden behind
      "0 bytes/event" taken literally.
- [x] Determinism confirmed byte-for-byte (scenario 10) — 3/3 runs produced an identical
      SHA-256 tape hash on immediate connect (`raw/s10_determinism/run{1,2,3}`); a
      supplementary late-join capture confirms the hash diverges when connection is not
      immediate, per ADR 004 — see `results.md` §3.10/§5(b).
- [x] The hardware ceiling is stated explicitly — `results.md` §4: at least 100,000
      events/sec (4× target) sustained at 100.03% with zero gaps and exchange CPU still
      under 61% of one core; the exact breaking point beyond 100,000/s is unmeasured, and
      that limit is stated rather than implied.
- [x] Raw probe output retained under `raw/` for every executed scenario, including the
      scenario-6 repair and the generator-throughput and late-join diagnostic captures added
      this session.

## Verification

```bash
./benchmarks/phase-2/capture-env.sh
./benchmarks/phase-2/run-benchmarks.sh
```

## Notes for other tasks
