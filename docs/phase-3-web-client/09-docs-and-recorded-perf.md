# Task 09 — Documentation, Recorded Performance Run & DoD Evidence

| | |
|---|---|
| **Phase** | 3 — Market Watch Web Client |
| **Status** | Not started |
| **Depends on** | 04, 05, 06, 07, 08 |
| **Blocks** | — (this closes the phase) |
| **Parallel with** | — |
| **Owns** | `client/Tckr.MarketWatch/README.md`, `perf/frame-timing.spec.ts`, `perf/raw/**`, `docs/phase-3-web-client/results.md`, the DoD checkboxes in `docs/phase-3-web-client/README.md` §9 |

> **Read [`benchmarks/phase-2/results.md`](../../benchmarks/phase-2/results.md) before
> writing a number.** It is the standard this phase is held to: every figure traceable to
> a file on disk, every gap stated plainly, nothing carried over from memory. Its §0
> ("a repair, not a fresh run") is the tone — an honest account beats a clean one.
>
> **State of the tree when you start:** tasks 01–08 are done and every one has filled in
> its *Notes for other tasks*. Read all eight before writing; they are the source material.

---

## Where this fits in Phase 3

```text
  01 contracts · 02 data · 03 shell · 04 list · 05 chart · 06 detail · 07 lifecycle · 08 conformance
                                        │
                                        ▼
                        ┌──────── you are here ─────────┐
                        │  README · results.md · DoD     │
                        │  the recorded Playwright run   │
                        └───────────────┬───────────────┘
                                        ▼
                     Phase 3 closes; Phase 4 (ingestion) begins
                     Phase 18 uses your README to perform the swap
```

You are the phase's closing argument. Someone arriving in Phase 18 — possibly a year
later — performs the gateway cutover using what you write, and the DoD boxes you tick are
what `STATE.md` will report as done.

---

## Objective

Produce the recorded performance measurement the phase's DoD demands, write the client
README that makes the Phase 18 swap a mechanical operation, and close out the phase DoD
with evidence for every box — or an explicit, reasoned deferral.

---

## Why this matters

Phase 2's DoD survives scrutiny because every claim in it points at a file:
`25,002.92 events/sec` is in `raw/s3_target_25k/run1/probe.json`, not in someone's memory
of a good run. Phase 3 makes one performance claim — that the render path holds up under a
hot symbol — and it is worth exactly as much as its evidence.

The CI invariant (task 02's coalescing ratio, task 05's one-`setData`-per-frame) proves the
*mechanism* deterministically, on every run, in jsdom. It cannot prove frames were actually
painted, because jsdom paints nothing. That gap is why the Playwright run exists, and why
its numbers live in a file rather than in a sentence.

The README matters for a duller reason: the phase's central promise is that the swap is one
environment variable. If that is true and undocumented, Phase 18 rediscovers it. If it is
false, you are the last person positioned to notice before the claim goes into `STATE.md`.

---

## Specification

### `perf/frame-timing.spec.ts`

One Playwright spec, run deliberately rather than in CI (task 07's DoD explains why frame
timing is a bad CI gate — the same reasoning that made Phase 2's flat-rate check misfire on
scenario 8).

- Serves the built app (`npm run build && npm run preview`), simulated source, seeded.
- Drives the hot symbol at **3,750 ticks/sec** — 15% of a 25,000/sec tape, matching the
  measured 14.4% top-1 share in `benchmarks/phase-2/results.md` §3.
- Opens `/symbols/COMI` (the head symbol) with the chart mounted and the list reachable.
- Measures over a **60-second** window, after a 10-second warm-up: frame timestamps via
  `requestAnimationFrame`, plus `performance.measure` around the flush path.
- Reports: frames rendered, mean/p50/p95/p99 frame interval, longest frame, fps, ticks
  received, flushes performed, coalescing ratio, and JS heap at start and end.
- Writes raw JSON to `perf/raw/frame-timing/run{1,2,3}/` — **three runs, not one**, per
  Phase 2's honesty rules.

Also capture the environment the way `benchmarks/phase-2/capture-env.sh` does: OS, CPU,
RAM, browser and version, Node version, build mode. Into `perf/raw/env.txt`.

### `docs/phase-3-web-client/results.md`

Sections, mirroring Phase 2's report:

1. **Environment** — the capture above.
2. **Method** — what was driven, for how long, what was excluded, and the honest statement
   that this is a simulated source on one machine, not the real pipeline.
3. **Results** — the table across three runs, median and spread.
4. **The CI invariant** — the deterministic numbers from tasks 02 and 05 (coalescing ratio,
   setData-per-frame), and what each does and does not prove.
5. **Threats to validity** — at minimum: simulated data is not the real tape; a headless
   browser is not a phone; heap numbers under a debugger are not production numbers; the
   3,750/sec figure is derived from Phase 2's measured skew, not from this client.
6. **What Phase 18 should re-measure** once real data flows.

Every number cites its raw file. Any figure you could not reproduce gets said so plainly,
Phase 2 style, rather than quietly dropped.

### `client/Tckr.MarketWatch/README.md`

- What it is, and the permanent caveat that the data is simulated and the instruments
  fictional.
- Run: install, dev, build, test, and the perf run.
- **The swap** — the section Phase 18 opens first:

  ```bash
  VITE_TCKR_SOURCE=gateway VITE_TCKR_GATEWAY_URL=ws://localhost:5000 npm run build
  ```

  plus exactly what changes and what does not, what the gateway must serve (link the
  contract), and the open contract questions task 08 raised.
- Architecture in one diagram: the `MarketDataSource` seam and its two implementations.
- Link the phase plan, the contract, ADR 006 and `results.md`.

### Phase DoD closeout

Work through `docs/phase-3-web-client/README.md` §9 and tick each box **with evidence** —
a command, a test name, a raw file — or leave it unticked with a written reason. An
unticked box with a reason is a fine outcome; a ticked box without evidence is not.

Then decide whether the chart/store decisions warrant an **ADR 007**. They were recorded as
settled decisions in the phase README §4 rather than as an ADR, which is enough if nothing
changed during implementation. If uPlot or the store pattern was replaced, or the perf
result contradicted the reasoning, write the ADR. Say either way in *Notes*.

---

## Inputs you can rely on

- All eight *Notes for other tasks* sections — measured numbers, deviations, and task 08's
  contract-ambiguity list, which feeds the README's swap section.
- `benchmarks/phase-2/results.md` for report structure and the honesty rules.
- `benchmarks/phase-2/capture-env.sh` as the model for environment capture.
- `perf/playwright.config.ts` from task 01.

---

## Constraints

- Every number in `results.md` traces to a file under `perf/raw/`.
- Three runs minimum for any reported figure; report median and spread, never a best run.
- No number is carried from a task's *Notes* into `results.md` without being reproduced
  from its raw output; if it cannot be reproduced, say so.
- No claim about the real pipeline — this phase measured a simulator.

## Out of scope

Changing any component to improve a number (raise it with the owning task instead),
running against a real gateway, editing another task's source.

---

## Tests

This task's output is documents and measurements, so its "tests" are reproductions:

| Check | Asserts |
|---|---|
| `npm run test:perf` from clean | produces `perf/raw/frame-timing/run1..3/` and exits 0 |
| re-read | every number in `results.md` is found in a raw file by `grep` |
| `npm ci && npm run build && npm test` from a clean clone | the README's instructions work as written |
| swap check | `VITE_TCKR_SOURCE=gateway npm run build` succeeds following only the README |

---

## Definition of done

- [ ] `perf/raw/frame-timing/run{1,2,3}/` exist with JSON output from three separate
      60-second runs, plus `perf/raw/env.txt`.
- [ ] `docs/phase-3-web-client/results.md` exists with all six sections; **every number in
      it appears in a file under `perf/raw/`** — verify by grepping each figure and paste
      the verification into *Notes*.
- [ ] The headline fps figure is reported as median across three runs with the spread, and
      the phase DoD's **≥30 fps** claim is either met (state the number) or explicitly not
      met (state the number and what it means).
- [ ] The CI invariant numbers (coalescing ratio, setData-per-frame) are quoted from tasks
      02 and 05 **and reproduced** by running their tests, not copied from their notes.
- [ ] `results.md` §5 lists at least four threats to validity, including that the source is
      simulated.
- [ ] `client/Tckr.MarketWatch/README.md` documents the swap as a single environment
      variable, and a reader following only that section can run
      `VITE_TCKR_SOURCE=gateway npm run build` successfully.
- [ ] Task 08's contract-ambiguity list is carried into the README's swap section, so
      Phase 11 inherits it.
- [ ] Every box in `docs/phase-3-web-client/README.md` §9 is either ticked with evidence
      named inline, or left unticked with a one-line reason.
- [ ] A decision on ADR 007 is recorded in *Notes*, with reasoning either way.
- [ ] From a clean clone: `npm ci && npm run build && npm test` succeed following the
      README alone — no undocumented step. State the clone path you tested from.

## Verification

```bash
cd client/Tckr.MarketWatch
npm ci && npm run build && npm test
npm run test:perf                       # three runs → perf/raw/frame-timing/
VITE_TCKR_SOURCE=gateway npm run build  # the swap, following the README only

# every number in the report is on disk:
grep -oE '[0-9]+\.[0-9]+' ../../docs/phase-3-web-client/results.md | sort -u | head
```

## Notes for other tasks

<!-- Fill in: the measured fps and its spread, the number-by-number verification against
     raw files, the ADR 007 decision, and anything a later phase must re-measure. -->
