# Phase 3 — Recorded Performance Results

**Status:** Complete for the phase DoD's performance and 400px-layout claims. Every
number below is read from a file under [`../../client/Tckr.MarketWatch/perf/raw/`](../../client/Tckr.MarketWatch/perf/raw/),
either directly or by re-running the test that produced it. No number here was
estimated, rounded from memory, or carried over from a task's *Notes* without being
reproduced against a file on disk. Per [`benchmarks/phase-2/results.md`](../../benchmarks/phase-2/results.md)
§0's standard, this document also states plainly where an initial measurement approach
was wrong and was corrected — see §3.1 (fps was not sensitive to the render-path load it
was meant to prove; superseded by `rafCallbackDurationMs` as the headline, after review)
and §3.3 (an axis-label pixel-colour scan, superseded by direct canvas-API
instrumentation).

---

## 1. Environment

Captured 2026-09-12. Full text: [`../../client/Tckr.MarketWatch/perf/raw/env.txt`](../../client/Tckr.MarketWatch/perf/raw/env.txt).

| | |
|---|---|
| CPU | Apple M5 Pro, 15 physical / 15 logical cores |
| RAM | 24 GB |
| OS | macOS 26.5 (build 25F71), Darwin 25.5.0 arm64 |
| Node | v24.18.0 |
| Browser | Google Chrome for Testing 153.0.8010.12 (Playwright chromium v1243, `@playwright/test` 1.63.0), **headless** — see §5 |
| Build tool | Vite 7.3.6, React 19.3.0, uPlot 1.6.32 |
| Build mode | `vite build` (production mode) in both configurations tested — see §2 |
| Git commit | `7145bd667fab5be5e99821a25175974f53c5e2bc` (branch `phase-3-web-client`; working tree had this task's own new/changed files at capture time) |

Two distinct builds were used, both `vite build` (production), differing only in
`VITE_TCKR_SIM_RATE`:

| Build | `VITE_TCKR_SIM_RATE` | Used for |
|---|---|---|
| "hot-load" build | `25000` | `perf/raw/frame-timing/run{1,2,3}` (§3) |
| "default" build | unset → `2000` (the app's own default) | `perf/raw/layout-400/` (§4) |

The rate is a build-time env var baked in by Vite (`import.meta.env`), read once by
`SimulatedSource`'s generator loop — it cannot be changed by a URL param or at runtime.
Using two builds is not a methodology inconsistency: §4 (is the 400px chart readable) and
§3 (does the render path hold up under the phase's specified hot-symbol load) are
different questions, and running the readability check under the artificial 3,750/sec
stress load actively produces a misleading answer — see §3.3.

---

## 2. Method

### 2.1 Frame timing (`perf/frame-timing.spec.ts`)

- Built with `VITE_TCKR_SIM_RATE=25000 npm run build`, served by `npm run preview` on
  `:4173` (Playwright's own `webServer`, per `perf/playwright.config.ts`).
- Navigates directly to `/symbols/COMI` (the head symbol; never visits `/` first).
  `SimulatedSource.generateBatch()` always generates across the full 34-symbol universe
  at the configured rate regardless of subscription (`src/data/SimulatedSource.ts`); only
  `emit()` filters by what is subscribed before pushing into `TickDispatcher`/the store.
  Since `StockDetail` subscribes to `['COMI']` alone, COMI receives its full weighted
  share of the configured 25,000/sec tape — **measured at 15.11% in
  `simulated.skew.test.ts`** (§6), i.e. **≈3,777 ticks/sec**, matching the brief's
  "3,750 ticks/sec — 15% of a 25,000/sec tape" to within the simulator's own measured
  skew tolerance. This reproduces the hot-symbol load with **no source change** — it is
  the same `VITE_TCKR_SOURCE`/`VITE_TCKR_SIM_RATE` env-var seam the Phase 11 swap itself
  uses.
- 10 s warm-up (unmeasured) after the chart mounts, then a 60 s measurement window.
- Instrumentation, installed via `page.addInitScript` **before any app script runs** — no
  file under `src/` is read, modified, or hooked internally:
  - An independent `requestAnimationFrame` loop (calling the *native*, unwrapped RAF)
    records one timestamp per actual browser animation frame — standard practice for
    measuring real paint cadence, decoupled from anything the app itself schedules.
  - `window.requestAnimationFrame` is also wrapped to time every callback the app
    schedules end-to-end. Exactly two things in this codebase ever call
    `requestAnimationFrame` (`grep -rn requestAnimationFrame src/`):
    `TickDispatcher.push` (the coalesced store-write flush) and `PriceChart`'s
    `scheduleRedraw` (the coalesced `uPlot.setData` call). Timing every wrapped callback
    times "the flush path" without adding a single `performance.mark` to application
    source.
  - JS heap (`performance.memory.usedJSHeapSize`) sampled at the start and end of the
    measurement window.
- Three separate 60 s runs (`run1`/`run2`/`run3`), each its own Playwright test, each
  writing full raw JSON (including every frame timestamp and every rAF-callback
  duration) to `perf/raw/frame-timing/run{N}/result.json`.
- **What this run does not measure, and why:** per-tick counters (`received`,
  `flushed`, the coalescing ratio) are internal to `TickDispatcher` and expose no global
  hook; adding one would be a source change, out of this task's scope. Those numbers are
  the CI invariant's job (§6) — reproduced separately, not approximated here.

### 2.2 400px layout and axis labels (`perf/layout-400.spec.ts`)

- Built with the **default** `VITE_TCKR_SIM_RATE` (2000/sec across the universe; COMI's
  ≈15% share is ≈300/sec) — see §3.3 for why the hot-load build is the wrong build for
  this check.
- Viewport `400×800`. `StockList` (`/`) and `StockDetail`+chart (`/symbols/COMI`) are
  each loaded and checked for horizontal overflow
  (`document.documentElement.scrollWidth <= clientWidth`).
- Axis-label counting: an `addInitScript` wraps
  `CanvasRenderingContext2D.prototype.fillText` (again, a global browser API, no `src/`
  file touched) to record every axis-label draw call uPlot's mounted instance issues —
  exact text, canvas position, resolved `fillStyle`/`globalAlpha`/font. uPlot derives
  `textAlign`/`textBaseline` from each axis's configured `side` in `PriceChart.tsx`
  (x-axis: `textBaseline: 'top'`; y-axis: `textBaseline: 'middle'`), which is what
  separates the two axes' calls without guessing. Distinct label **text** values drawn
  within one settled redraw (sampled after a 5 s warm-up, over the next two animation
  frames) are counted per axis. See §3.3 for why this replaced an earlier pixel-colour
  scan.
- Screenshots of both pages, and of the chart alone, are saved to
  `perf/raw/layout-400/*.png` for direct human inspection.

### 2.3 Honesty statement

This is a **simulated data source on one machine**, not the real ingestion pipeline —
no gateway, no network hop, no Kafka. `SimulatedSource`'s generator and `TickDispatcher`
are exercised faithfully (same code path a real `TckrGatewaySource` tick would take once
it reaches `on.tick`/the store), but nothing here says anything about network-induced
jitter, gateway fan-out cost, or real market data shape. See §5 for the full list of
threats to validity.

---

## 3. Results — frame timing

### 3.1 Headline: the render path's own cost under the hot-symbol load

**This section was corrected after initial publication.** The first version of this
report led with fps as the headline number. A control experiment (§3.1.2) showed fps
does not actually respond to the hot-symbol load in this environment, so it cannot carry
the claim by itself. The corrected headline is below; §3.1.1 keeps fps as supporting
evidence with its limitation stated plainly, per this project's convention of recording a
wrong intermediate conclusion rather than quietly replacing it (see also §3.3, a
different measurement correction from the same session).

**The coalesced flush path costs ≈0.6% of the frame budget under load.**
`rafCallbackDurationMs` — wall time inside every `requestAnimationFrame` callback the app
itself schedules (`TickDispatcher`'s store-write flush + `PriceChart`'s `uPlot.setData`
redraw; see §2.1, these are the only two rAF consumers in `src/`) — has **p95 = 0.0999 ms,
mean = 0.0101 ms, max = 0.2 ms**, median across the 3 runs
(`perf/raw/frame-timing/run{1,2,3}/result.json`, field `rafCallbackDurationMs`), against
a 16.7 ms frame budget at 60 Hz. **That is ≈0.6% of the frame budget consumed by the
app's own work on the hot path, at ≈3,777 ticks/sec landing on one symbol** — a direct
measurement of the thing the DoD actually asks about ("does the render path hold up"),
not an inference from a proxy metric. This is the number the phase DoD's chart/hot-symbol
box rests on.

### 3.1.1 fps — supporting evidence, not the headline

**Median 60.00 fps across 3 runs, spread 0.0001 fps** (individual runs: 60.00243,
60.00243, 60.00233 — `perf/raw/frame-timing/run{1,2,3}/result.json`, field `fps`); every
one of the 3,600 frames captured per run landed within a 0.3 ms band of the ideal
16.67 ms interval, and no run recorded a dropped or delayed frame. This clears the ≥30 fps
floor and is recorded as confirmation that **no frame was actually dropped** during the
measurement window — a real, useful fact.

**It is not, on its own, evidence that the render path "holds up under load"**, and is
demoted to supporting status for a specific, demonstrated reason (§3.1.2): a headless
Chromium tab's `requestAnimationFrame` callback rate is driven by the compositor's vsync
timer, not by how much work the page does per frame, as long as that work stays under
budget. This spec's own module doc already said as much about the independent
frame-cadence probe ("would report the same fps even if the app never touched the DOM at
all") — the control experiment below is what turns that into a measured fact rather than
a caveat nobody checked.

### 3.1.2 Control experiment — proving fps is insensitive, and that the load was real

Run by the coordinator reviewing this task, not as part of this task's own 3-run
canonical measurement (per this task's constraint against re-running or altering
`perf/raw/frame-timing/run{1,2,3}`, that directory is untouched and remains the frozen
record). Recorded here, attributed, rather than silently adopted as this task's own raw
data — the same convention `benchmarks/phase-2/results.md` §5(a) uses for a cited number
that is real but not a `raw/` artifact of that session.

**Command:** rebuild at 250× less load, then run one 60 s frame-timing case unchanged:

```bash
VITE_TCKR_SIM_RATE=100 npm run build
npx playwright test -c perf/playwright.config.ts perf/frame-timing.spec.ts -g "run 1"
```

| Metric | Rate 100 (control) | Rate 25,000 (this task's recorded run 1) |
|---|---:|---:|
| `rafCallbackDurationMs.count` (60 s) | **1,318** | **2,400** |
| fps | 60.002400096 | 60.002434108 |
| Frame interval mean (ms) | 16.665999999 | 16.665990552 |
| Frame interval max (ms) | 16.80000000000291 | 16.80000000000291 |
| JS heap Δ (bytes) | 0 | 0 |

**Two conclusions, in opposite directions:**

1. **The hot-symbol load in `perf/raw/frame-timing/run{1,2,3}` was genuinely applied.**
   The rAF-callback count — how often the coalesced flush actually ran — differs by 82%
   between the two builds (1,318 vs 2,400 over the same 60 s window), tracking the
   250× difference in configured rate in the correct direction. This is in-data proof
   that `dist/` really was built with `VITE_TCKR_SIM_RATE=25000` for this task's own
   runs, closing a gap §3.3/§5.6 could previously only assume:
   `configuredEventsPerSecond` in each raw file records what the *test process's own
   environment* believed the rate to be, which — as stated at the time — could not by
   itself prove the *served bundle* matched. The callback-count response does prove it.
2. **fps, frame interval, and heap delta are all identical to ~5 decimal places across a
   250× load difference.** A metric that reads the same under a 250×-smaller load is not
   measuring the load. This is not a flaw in how the spec computed fps (§2.1's method is
   unchanged and correct) — it is a property of headless Chromium's fixed 60 Hz
   compositor timer, which this app's rAF usage cannot influence one way or the other as
   long as its own work (§3.1's ≈0.6%-of-budget figure) stays far under the 16.7 ms
   budget, which it does by roughly two orders of magnitude at both rates tested.
   **`heap.deltaBytes = 0` at both rates is further evidence the figure is a
   `performance.memory` quantization artifact (§3.2/§5.4), not a measurement of flat
   memory usage** — it does not move even when the underlying tick volume driving
   allocation moves by 250×, which is what an actual "no leak" measurement should show
   sensitivity to and this one does not.

**Why this control experiment is not itself promoted to a `perf/raw/` artifact of this
task:** doing so would mean either altering the frozen `run{1,2,3}` directory (barred) or
writing a new raw file for a measurement this task did not itself execute (misattributing
authorship of the evidence). The numbers above are reported exactly as given, attributed
to the reviewer who ran them, and are trivially reproducible by anyone via the two
commands above.

### 3.2 Full table (median across 3 runs; spread = max − min)

| Metric | Run 1 | Run 2 | Run 3 | Median | Spread |
|---|---:|---:|---:|---:|---:|
| Frames rendered (60 s window) | 3,600 | 3,600 | 3,600 | 3,600 | 0 |
| fps | 60.00243 | 60.00243 | 60.00233 | 60.00243 | 0.0001 |
| Frame interval mean (ms) | 16.6660 | 16.6660 | 16.6660 | 16.6660 | 0.00003 |
| Frame interval p50 (ms) | 16.700 | 16.700 | 16.700 | 16.700 | 0 |
| Frame interval p95 (ms) | 16.700 | 16.700 | 16.800 | 16.700 | 0.1 |
| Frame interval p99 / max (ms) | 16.800 | 16.800 | 16.800 | 16.800 | 0 |
| rAF-callback ("flush path") count | 2,400 | 2,400 | 2,400 | 2,400 | 0 |
| rAF-callback duration mean (ms) | 0.0101 | 0.0100 | 0.0104 | 0.0101 | 0.0004 |
| rAF-callback duration p95 (ms) | 0.100 | 0.100 | 0.100 | 0.100 | 0 |
| rAF-callback duration max (ms) | 0.200 | 0.200 | 0.200 | 0.200 | 0 |
| JS heap Δ over 60 s (bytes) | 0 | 0 | 0 | 0 | 0 |

All figures: `perf/raw/frame-timing/run{1,2,3}/result.json` (`frameIntervalMs`,
`rafCallbackDurationMs`, `heap` objects). Reproduce with:

```bash
cd client/Tckr.MarketWatch
VITE_TCKR_SIM_RATE=25000 npm run build
VITE_TCKR_SIM_RATE=25000 npm run test:perf
```

**Reading the rAF-callback count (2,400 over 60 s = 40/sec):** the coalesced
flush-and-redraw path actually runs roughly 40 times per second, not the ≈3,777
ticks/sec arriving — real-browser confirmation that coalescing is doing its job,
consistent with (though not a substitute for — see §6) the CI invariant's "at most one
flush per frame" guarantee. §3.1.2's control experiment additionally shows this count is
*sensitive* to the configured load (1,318 at rate 100 vs 2,400 at rate 25,000) — unlike
fps, it moves with the thing being measured, which is what makes it (via its per-call
duration, §3.1) the number this report's headline claim rests on.

**JS heap:** all three runs report **exactly 10,000,000 bytes** at both the start and
end of the measurement window (`heap.atStartBytes`/`atEndBytes`), for a delta of 0.
**Do not read this as evidence of flat/no-leak memory usage.** The round number strongly
suggests Chromium's `performance.memory` is quantizing its result to a coarse bucket (a
documented privacy mitigation in recent Chrome versions, independent of this app) rather
than reporting exact heap usage — see §5.4. §3.1.2's control experiment reinforces this
reading directly: the same `heap.deltaBytes = 0` appears at `VITE_TCKR_SIM_RATE=100`
(250× less allocation-driving tick volume) as at 25,000. A metric that does not move
when the thing that would drive it moves by 250× is not measuring that thing. It is
reported here as measured, with this caveat attached everywhere it is cited, never as
precise evidence of "zero allocation" or "no leak."

### 3.3 A measurement mistake, corrected — axis-label counting

The first version of `perf/layout-400.spec.ts` counted x/y-axis labels by scanning
rendered canvas pixels for the grid-line colour (`--tckr-color-border`, a light gray).
Two things then went wrong, and both are recorded here rather than quietly fixed and
forgotten, per this project's convention:

1. **It found only 1 vertical grid line at 400px under the hot-load (`VITE_TCKR_SIM_RATE=25000`)
   build**, which was real: at ≈3,777 ticks/sec into COMI, the chart's 600-point ring
   buffer (`src/chart/ringBuffer.ts`, capacity fixed by design decision #5) holds under
   0.2 seconds of history — too narrow a time domain for more than one "nice" x-axis
   split to land inside it. This is a genuine, reproducible product characteristic
   (confirmed again at 1,200px desktop width and with a completely different, cold
   symbol — it is not a 400px-specific defect), **not fixed by this task** (`src/chart/**`
   is task 05's, and this task's brief bars changing a component to improve a number).
   It is carried forward as an open item in ADR 006 and below (§7).
2. Separately, when re-run against the **default-rate** build (still driving real ticks,
   just not at stress-test volume), the same pixel-colour heuristic still under-counted —
   this time wrongly. The heuristic's colour target was the *grid-line* colour, but a
   manual visual re-check of the resulting screenshots looked blank in the axis-label
   band regardless, which pointed at "text isn't rendering" as a second, independent
   defect. Instrumenting `CanvasRenderingContext2D.fillText` directly (see §2.2) proved
   that conclusion **wrong**: uPlot was issuing correct, fully-opaque
   (`fillStyle:"#5b6472"`, `globalAlpha:1`) draw calls with sane text and position the
   entire time. The screenshots "looking blank" was an artifact of how this task's own
   image review of a tall, cropped PNG was truncating before the bottom axis band —
   not a rendering bug in the app. The pixel-scan method was discarded in favour of the
   `fillText`-instrumentation method described in §2.2, which reads the actual draw
   instruction rather than inferring one after the fact from pixels.

The corrected, final measurement (§4) is what the phase DoD claims are built on. This
paragraph stays in the document because a wrong intermediate number that quietly becomes
a "confirmed" one is exactly the failure mode Phase 2's `results.md` §0 warns about.

---

## 4. Results — 400px layout and axis labels

`perf/raw/layout-400/` (default-rate build):

| Check | Result | Raw file |
|---|---|---|
| `StockList` horizontal overflow at 400px | none (`scrollWidth` 400 = `clientWidth` 400) | `stocklist-400-overflow.json` |
| `StockList` renders all 34 rows + visible search box at 400px | yes | `stocklist-400.png` |
| `StockDetail`+chart horizontal overflow at 400px | none (`scrollWidth` 400 = `clientWidth` 400) | `stockdetail-400-overflow.json` |
| Y-axis distinct labels at 400px | **7** (`84.50, 84.75, 85.00, 85.25, 85.50, 85.75, 86.00`) | `axis-labels-400.json` |
| X-axis distinct labels at 400px | **2** (`20:06:46, 20:06:48`) | `axis-labels-400.json` |

**DoD floor: ≥3 y-axis labels, ≥2 x-axis labels — both met** (7 ≥ 3; 2 ≥ 2), at 400px,
under the app's default configuration, via direct instrumentation of uPlot's own draw
calls (§2.2), not an inference from pixels or a screenshot.

The x-axis count is exactly at the floor, not comfortably above it — a direct
consequence of the same ring-buffer-vs-tick-rate interaction noted in §3.3: even at the
default (non-stress) rate, COMI's ≈300 ticks/sec fills the 600-point buffer in
≈2 seconds, leaving only a ≈2-second-wide x-domain to place labels in. `axes.ts`'s
`X_AXIS_INCREMENTS_MS` floor is 1,000 ms, so a 2-second domain can offer at most 2–3
"nice" 1-second splits before running out of room — this measurement is at the edge of
what the current ring-buffer capacity can support, not a comfortable margin. Reproduce
with:

```bash
cd client/Tckr.MarketWatch
npm run build   # default VITE_TCKR_SIM_RATE
npx playwright test -c perf/playwright.config.ts perf/layout-400.spec.ts --reporter=list
```

---

## 5. Threats to validity

1. **Simulated data, one machine, no gateway.** Every tick in this report comes from
   `SimulatedSource`'s in-browser random walk, not the real exchange tape or a real
   `TckrGatewaySource` connection. No network hop, no Kafka, no gateway fan-out cost is
   present anywhere in these numbers.
2. **Headless Chromium's fps is not sensitive to this app's render-path cost, and this is
   now measured, not assumed (§3.1.2).** A control run at 250× less load
   (`VITE_TCKR_SIM_RATE=100`) produced fps, frame-interval, and heap figures identical to
   this report's recorded runs to ~5 decimal places. `perf/playwright.config.ts` does not
   set `headless: false`; a real windowed browser on real display hardware (and
   definitely a phone, given the 400px claim) can behave differently under
   compositor/GPU pressure this method cannot reproduce — but the specific failure mode
   this threat used to only warn about in the abstract (fps looking fine regardless of
   actual load) is the one §3.1.2 demonstrates directly, which is why the headline claim
   was moved off fps entirely rather than merely caveated.
3. **The 3,750/sec figure is derived, not measured from this client's own tape.** It
   comes from `benchmarks/phase-2/results.md` §3's measured 14.4% top-1 symbol share of
   the mock exchange's real 25,000/sec tape; this client's own simulator independently
   measures a close but not identical **15.11%** top-1 share (`simulated.skew.test.ts`,
   §6) over its own seeded random walk. The two are not the same tape.
4. **`performance.memory` is coarse, confirmed by a control experiment, not just
   inferred from a round number.** All three heap measurements read exactly
   10,000,000 bytes at both ends of the window (§3.2) — already suspicious as a
   quantization bucket (a documented Chrome privacy behavior) rather than a precise
   reading — and §3.1.2's control run at 250× less load reads the identical
   `deltaBytes = 0`. A heap-delta claim finer than whatever that bucket size is cannot be
   supported by this data, and "no leak" is not a claim this report makes.
5. **One host, one point in time.** All measurements were taken on a single Apple M5 Pro
   during one session; no attempt was made to characterize variance across hardware,
   thermal state, or browser version.
6. **The build matters, is easy to get wrong, and this was caught, twice.** §3.3
   documents this task initially measuring the wrong build's chart; §3.1.2's control
   experiment exists because a reviewer asked "how do you know `dist/` really carried
   the configured rate," and the answer is now an in-data one (the rAF-callback count
   responds 82% to a 250× rate change) rather than an assumption resting on
   `configuredEventsPerSecond`, which only records what the test process's own
   environment believed, not what was actually served. Nothing prevents a future run
   from making a similar mistake in a new way.
7. **A 60 s window is not a soak.** Per Phase 2's own precedent (its scenario 9, 30-minute
   soak, was explicitly deferred as non-DoD), this report says nothing about frame timing
   or memory behavior over minutes or hours of a tab left open on a hot symbol.

---

## 6. The CI invariant — reproduced, not copied

These are quoted from tasks 02/05's design and **reproduced in this session** by running
the actual tests, per the DoD requirement — not copied from either task's *Notes* (which
were left as unfilled templates by both tasks; see the "Notes for other tasks" caveat in
§8). Raw stdout for every command below is saved under
`client/Tckr.MarketWatch/perf/raw/vitest-invariants/`.

| Claim | Test | Result | Raw file(s) |
|---|---|---|---|
| One flush per symbol per animation frame (3,750-tick single-frame burst) | `dispatcher.coalescing.test.ts` | **passed** — the literal `3750` tick-count and the assertion `flushed).toHaveLength(1)` are in the test source; the run confirms it passes (this test does not print counts at runtime) | `dispatcher.coalescing.out.txt` (pass/timing) + `src/data/__tests__/dispatcher.coalescing.test.ts` (the literal numbers, lines defining the 3,750-iteration loop and the `toHaveLength(1)` assertion) |
| Coalescing ratio ≥50× sustained over 60 frames at 3,750 ticks/sec | `dispatcher.coalescing.test.ts` | **received=225,000, flushed=60, ratio=3750×**, printed at runtime | `dispatcher.coalescing.out.txt` |
| At most one `uPlot.setData` call per animation frame | `chart.one-setdata-per-frame.test.tsx` | **passed** — test source asserts `setData` called exactly once for 500 store notifications delivered before one frame flush, and that the single call's arrays each have length 500; run confirms pass (no runtime printout) | `chart.one-setdata-per-frame.out.txt` (pass/timing) + `src/chart/__tests__/chart.one-setdata-per-frame.test.tsx` (the literal `500`/`toHaveBeenCalledTimes(1)` assertions) |
| Ring buffer stays bounded | `ringBuffer.capacity.test.ts` | **passed** — test source asserts `buffer.length === 600` after 100,000 pushes into a capacity-600 buffer, and (`ringBuffer.no-alloc.test.ts`) that the backing `Float64Array` references never change; run confirms pass | `ringBuffer.out.txt` (pass/timing) + `src/chart/__tests__/ringBuffer.capacity.test.ts` / `ringBuffer.no-alloc.test.ts` (the literal `600`/`100_000` assertions) |
| A tick for one symbol re-renders only that symbol's row | `StockList.render-isolation.test.tsx` | COMI render count **+1**, all other 33 rows **+0** (asserted generically as a before/after diff in test source; run confirms pass, no runtime printout of the exact counts) | `render-isolation.out.txt` (pass/timing) + `src/pages/__tests__/StockList.render-isolation.test.tsx` (the `comiDelta === 1` / `othersUnchanged === true` assertions) |
| Simulated skew matches the exchange's measured skew | `simulated.skew.test.ts`, `simulated.mix.test.ts` | top-1 **15.11%**, top-10 **61.39%** (exchange: 14.4% / 59.1%); TRADE 40.11% / BID 30.02% / ASK 29.87% | `simulated.skew-mix.out.txt` |
| Reconnect backoff matches contract §4 exactly | `reconnect.backoff.test.ts`, `reconnect.jitter.test.ts` | 500, 1000, 2000, 4000, 8000, 16000, 30000×4 ms at `rand=0.5`; attempt 3 spans exactly [1600, 2400] ms | `reconnect.backoff-jitter.out.txt` |
| `StockDetail` nets exactly one subscription under StrictMode | `StockDetail.subscribe-lifecycle.test.tsx` | call log `[subscribe, unsubscribe, subscribe]`, **net = 1** | `strictmode-subscribe.out.txt` |

**What this proves and does not prove:** these are deterministic, jsdom-based
assertions on call counts and object identity. They prove the *mechanism* — coalescing
happens, at most one redraw is scheduled, the buffer never grows — on every CI run,
regardless of host. They cannot prove a frame was ever actually painted, because jsdom
has no canvas and does not paint anything at all. That is exactly the gap §3's real
Chromium run fills, and why the phase's DoD asks for both.

**Verification that every number in this document is grep-able in a raw file**, per the
DoD requirement:

```
$ grep -r "225000\|3750" client/Tckr.MarketWatch/perf/raw/vitest-invariants/dispatcher.coalescing.out.txt
[dispatcher.coalescing] received=225000 flushed=60 ratio=3750x

$ grep -r "15.11\|61.39" client/Tckr.MarketWatch/perf/raw/vitest-invariants/simulated.skew-mix.out.txt
[simulated.skew] top1=15.11% top10=61.39% (exchange measured: 14.4% / 59.1%)

$ grep -r "60.00243410819111\|60.00233407245628" client/Tckr.MarketWatch/perf/raw/frame-timing/run*/result.json
run1/result.json:  "fps": 60.00243410819111,
run3/result.json:  "fps": 60.00233407245628,

$ grep -r "\"yAxisDistinctLabelText\"" -A8 client/Tckr.MarketWatch/perf/raw/layout-400/axis-labels-400.json
```

All four checks were run for real during this session and matched.

---

## 7. What Phase 18 should re-measure

- **Real `rafCallbackDurationMs` (not just fps) under a real gateway connection**, once
  `TckrGatewaySource` is live — network jitter and a real WebSocket's own event-loop
  scheduling are not present in this report at all (§5.1), and §3.1.2 established that
  fps alone would not surface a regression here even if one existed.
- **The ring-buffer-vs-tick-rate interaction found in §3.3/§4.** At the *default*
  simulated rate, COMI's x-axis label count (2) is exactly at the phase's own floor, not
  comfortably above it; at the phase's specified *hot-load* rate, the chart's visible
  time domain collapses to under a fifth of a second. Once real exchange tick rates are
  available, re-measure whether the 600-point default capacity (design decision #5)
  still gives a usable time-axis for the busiest instruments, or whether the buffer
  should be time-bounded (e.g. "last N seconds") rather than count-bounded. Flagged for
  task 05/a future task, not fixed here — see ADR 006.
- **Heap behavior over a real multi-minute or multi-hour session**, not a 60 s window
  (§5.7), and with a non-quantized memory API if one becomes available (§5.4).
- **`rafCallbackDurationMs` and fps together on a real mobile device at 400px width**,
  not a headless desktop Chromium (§5.2) — the phase's own 400px requirement is
  explicitly about a phone-width display, and a real phone's weaker CPU is exactly where
  fps could start responding to render-path cost in a way this desktop-headless
  measurement cannot show either way.

---

## 8. Notes — verification and decisions

- **Number-by-number verification against raw files:** every numeric claim in §3, §4 and
  §6 above was re-derived in this session from a file under `perf/raw/` (§3, §4) or from
  freshly-run test stdout saved under `perf/raw/vitest-invariants/` (§6) — see the grep
  transcript in §6. No number was carried over from a task's own *Notes for other tasks*
  section without being reproduced; as it happens, tasks 01–08 all left that section as
  the unfilled template comment, so there was nothing to carry over uncritically in the
  first place — every figure in this report was independently re-run.
- **ADR 007 decision: not written.** The brief's trigger conditions are "uPlot or the
  store pattern was replaced" (neither was — both are unchanged from README.md §4's
  settled decisions) or "the perf result contradicted the reasoning" (it did not — §3.1's
  rAF-callback duration, ≈0.6% of the frame budget under the hot-symbol load, is a direct
  confirmation of design decision #4's coalescing argument and #9's render-isolation
  argument). The one new, real finding from this session — the ring-buffer-capacity vs.
  hot-symbol-tick-rate interaction (§3.3/§4/§7) — is a genuine open question, but it is an
  *emergent property* of a decision that did its stated job (bounding memory, per design
  decision #5) rather than a case where the decision itself was wrong or reversed; it is
  recorded here and in ADR 006 as a flagged follow-up rather than promoted to its own ADR.
- **Headline figure for the phase DoD: `rafCallbackDurationMs` p95 = 0.0999 ms** (≈0.6% of
  the 16.7 ms frame budget) at ≈3,777 ticks/sec on COMI, median across 3 runs (§3.1) — a
  direct measurement of the render path's own cost under load, and what the ≥30 fps DoD
  box actually rests on. fps (median **60.00 fps**, spread **0.0001 fps**, §3.1.1) clears
  the ≥30 fps floor and confirms zero dropped frames, but is *not* the load-bearing number
  — §3.1.2's control experiment (a 250×-lower-load rebuild producing an fps figure
  identical to ~5 decimal places) shows fps does not respond to this app's render-path
  cost in a headless-Chromium environment, so it cannot by itself demonstrate "holds up
  under load." This is a correction from this report's first published version, made
  after review; recorded here rather than silently edited away, per §3.1's own note.
