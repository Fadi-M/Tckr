/**
 * Task 09 — the one recorded, real-browser performance measurement for Phase 3
 * (docs/phase-3-web-client/09-docs-and-recorded-perf.md). Run deliberately, never in CI
 * (see that task's brief and task 07's DoD for why frame timing is a bad CI gate).
 *
 * What this proves that the Vitest CI invariant (dispatcher.coalescing.test.ts,
 * chart.one-setdata-per-frame.test.tsx) cannot: jsdom paints nothing, so it can assert
 * "one flush per frame" as a call-count but never "a frame was actually painted at an
 * acceptable rate." This spec drives the built app in a real Chromium tab and measures
 * real `requestAnimationFrame` cadence under the same hot-symbol load the CI invariant
 * uses (~15% of a 25,000/sec tape onto one symbol, per benchmarks/phase-2/results.md
 * §3's measured top-1 share).
 *
 * How the load is produced: `SimulatedSource.generateBatch()` (src/data/SimulatedSource.ts)
 * always generates across the FULL 34-symbol universe at `VITE_TCKR_SIM_RATE` events/sec,
 * regardless of what is subscribed — only `emit()` filters by `this.subscribed` before
 * pushing into `TickDispatcher`/the store (see `SimulatedSource.ts` lines ~522-536). So
 * navigating straight to `/symbols/COMI` (never visiting `/`) means `StockDetail` calls
 * `subscribe(['COMI'])` alone, and COMI receives its full ~15% weighted share of whatever
 * `VITE_TCKR_SIM_RATE` is configured to, with every other generated tick silently dropped
 * at the subscription filter. At `VITE_TCKR_SIM_RATE=25000` that is ~3,750 ticks/sec
 * landing on COMI's store entry — exactly the load the brief specifies — with **no source
 * change required**: this is a build-time env var, the same knob `config.ts` already
 * exposes for the Phase 11 swap.
 *
 * Required invocation (see client/Tckr.MarketWatch/README.md and results.md §2
 * "Method") — the same env var must be set for both the build and the test run:
 *
 *   VITE_TCKR_SIM_RATE=25000 npm run build
 *   VITE_TCKR_SIM_RATE=25000 npm run test:perf
 *
 * (`npm run preview` — started automatically by perf/playwright.config.ts's `webServer`
 * — only serves whatever is already in `dist/`; it does not rebuild. The build's env var
 * controls what rate is actually generated in the browser; this test process's own copy
 * of the same var is recorded verbatim into every raw file as `configuredEventsPerSecond`
 * so a mismatched pair — e.g. an unrebuilt `dist/` from a prior default-rate build — is
 * visible in the data rather than silently assumed away.)
 *
 * Instrumentation strategy — no source file in `src/` is touched or hooked internally.
 * An init script (runs before any app code, via `page.addInitScript`) wraps the two
 * browser globals the app's render path already depends on:
 *
 *   - `window.requestAnimationFrame` is wrapped so every callback the app itself
 *     schedules is timed end-to-end. Only two things in this codebase ever call
 *     `requestAnimationFrame` (confirmed by `grep -rn requestAnimationFrame src/`):
 *     `TickDispatcher.push` (src/data/TickDispatcher.ts) and `PriceChart`'s
 *     `scheduleRedraw` (src/chart/PriceChart.tsx). Timing every wrapped callback
 *     therefore times "the flush path" the brief asks for — the store-write flush and
 *     the chart's `setData` redraw — without adding a single `performance.mark` call to
 *     application source.
 *   - A second, independent `requestAnimationFrame` loop (also installed by the init
 *     script, calling the *native*, unwrapped RAF) records one timestamp per actual
 *     browser animation frame. This is the standard technique for measuring real paint
 *     cadence and is completely decoupled from whatever the app schedules — it would
 *     report the same fps even if the app never touched the DOM at all.
 *
 * What this spec does NOT attempt to measure, and why: per-tick counters (`received`,
 * `flushed`, the coalescing ratio) are internal to `TickDispatcher`, which exposes no
 * global hook and is not something this task may add to `src/data/**` (out of ownership,
 * and the brief's own "Out of scope" bars changing a component to improve or expose a
 * number). Those figures are the CI invariant's job — proven deterministically by
 * `dispatcher.coalescing.test.ts` and `chart.one-setdata-per-frame.test.tsx`, reproduced
 * and cited in results.md §4 — and are correctly absent from this browser run's raw
 * output rather than approximated or guessed at here.
 */
import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW_DIR = resolve(HERE, 'raw', 'frame-timing');

const WARMUP_MS = 10_000;
const MEASURE_MS = 60_000;
const HOT_SYMBOL = 'COMI';

interface PageMetrics {
  readonly configuredEventsPerSecond: number | null;
  readonly frameTimestamps: readonly number[];
  readonly rafCallbackDurationsMs: readonly number[];
  readonly heapAtStartBytes: number | null;
  readonly heapAtEndBytes: number | null;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}

function summarize(values: readonly number[]): {
  count: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  min: number;
} {
  if (values.length === 0) {
    return { count: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0, min: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    count: values.length,
    mean: sum / values.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1]!,
    min: sorted[0]!,
  };
}

for (const run of [1, 2, 3] as const) {
  test(`frame timing — run ${run} — ${HOT_SYMBOL} hot symbol, ${WARMUP_MS / 1000}s warm-up + ${
    MEASURE_MS / 1000
  }s measurement window`, async ({ page, browserName }) => {
    test.setTimeout(WARMUP_MS + MEASURE_MS + 60_000);

    // Install the instrumentation before any app script executes (addInitScript runs on
    // every subsequent navigation/reload in this page's lifetime, before page scripts).
    await page.addInitScript(() => {
      const w = window as unknown as {
        __tckrPerf: {
          frameTimestamps: number[];
          rafCallbackDurationsMs: number[];
          heapAtStartBytes: number | null;
          heapAtEndBytes: number | null;
        };
      };
      w.__tckrPerf = {
        frameTimestamps: [],
        rafCallbackDurationsMs: [],
        heapAtStartBytes: null,
        heapAtEndBytes: null,
      };

      const nativeRAF = window.requestAnimationFrame.bind(window);

      // Time every callback the app itself schedules via requestAnimationFrame — see
      // this file's module doc for why this is "the flush path" (TickDispatcher's
      // flush + PriceChart's redraw are the only two rAF consumers in src/).
      window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
        nativeRAF((ts) => {
          const t0 = performance.now();
          cb(ts);
          const t1 = performance.now();
          w.__tckrPerf.rafCallbackDurationsMs.push(t1 - t0);
        })) as typeof window.requestAnimationFrame;

      // Independent frame-cadence probe: one timestamp per actual browser animation
      // frame, via the native (unwrapped) RAF, decoupled from anything the app does.
      function probe(ts: number): void {
        w.__tckrPerf.frameTimestamps.push(ts);
        nativeRAF(probe);
      }
      nativeRAF(probe);
    });

    await page.goto(`/symbols/${HOT_SYMBOL}`);
    await page.waitForSelector('.tckr-price-chart__canvas canvas', { timeout: 15_000 });

    // Warm-up: let the simulated tape, the chart's ring buffer and JIT warm up before
    // the measurement window starts. Not measured.
    await page.waitForTimeout(WARMUP_MS);

    // What VITE_TCKR_SIM_RATE was *intended* to be baked into the served `dist/` —
    // recorded from the same env var this test invocation was run with (see this
    // file's module doc: `VITE_TCKR_SIM_RATE=25000 npm run build` must have been run
    // first). This is a record of the driving configuration, not a measurement — it
    // does not verify the build was actually current. `preview`'s `dist/` is not
    // rebuilt by this test.
    const configuredEventsPerSecond = process.env['VITE_TCKR_SIM_RATE']
      ? Number(process.env['VITE_TCKR_SIM_RATE'])
      : null;

    // Reset the counters right after warm-up so the 60s window starts clean.
    await page.evaluate(() => {
      const w = window as unknown as {
        __tckrPerf: { frameTimestamps: number[]; rafCallbackDurationsMs: number[]; heapAtStartBytes: number | null };
      };
      w.__tckrPerf.frameTimestamps = [];
      w.__tckrPerf.rafCallbackDurationsMs = [];
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      w.__tckrPerf.heapAtStartBytes = mem ? mem.usedJSHeapSize : null;
    });

    await page.waitForTimeout(MEASURE_MS);

    const metrics: PageMetrics = await page.evaluate(() => {
      const w = window as unknown as {
        __tckrPerf: {
          frameTimestamps: number[];
          rafCallbackDurationsMs: number[];
          heapAtStartBytes: number | null;
        };
      };
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      return {
        configuredEventsPerSecond: null, // filled in by the test body from process.env
        frameTimestamps: w.__tckrPerf.frameTimestamps,
        rafCallbackDurationsMs: w.__tckrPerf.rafCallbackDurationsMs,
        heapAtStartBytes: w.__tckrPerf.heapAtStartBytes,
        heapAtEndBytes: mem ? mem.usedJSHeapSize : null,
      };
    });

    const timestamps = metrics.frameTimestamps;
    const intervals: number[] = [];
    for (let i = 1; i < timestamps.length; i += 1) {
      intervals.push(timestamps[i]! - timestamps[i - 1]!);
    }
    const durationActualMs = timestamps.length > 1 ? timestamps[timestamps.length - 1]! - timestamps[0]! : 0;
    const fps = durationActualMs > 0 ? ((timestamps.length - 1) * 1000) / durationActualMs : 0;

    const result = {
      run,
      symbol: HOT_SYMBOL,
      browser: browserName,
      configuredEventsPerSecond,
      warmupMs: WARMUP_MS,
      measureMs: MEASURE_MS,
      framesRendered: timestamps.length,
      measuredWindowDurationMs: durationActualMs,
      fps,
      frameIntervalMs: summarize(intervals),
      // "the flush path" — see module doc: every requestAnimationFrame callback the app
      // itself scheduled (TickDispatcher flush + PriceChart redraw combined; this
      // codebase has no third rAF consumer).
      rafCallbackDurationMs: summarize(metrics.rafCallbackDurationsMs),
      heap: {
        atStartBytes: metrics.heapAtStartBytes,
        atEndBytes: metrics.heapAtEndBytes,
        deltaBytes:
          metrics.heapAtStartBytes !== null && metrics.heapAtEndBytes !== null
            ? metrics.heapAtEndBytes - metrics.heapAtStartBytes
            : null,
        note:
          metrics.heapAtStartBytes === null
            ? 'performance.memory unavailable in this browser context; heap not measured'
            : undefined,
      },
      capturedAt: new Date().toISOString(),
      rawFrameTimestamps: timestamps,
      rawRafCallbackDurationsMs: metrics.rafCallbackDurationsMs,
    };

    const runDir = resolve(RAW_DIR, `run${run}`);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(resolve(runDir, 'result.json'), JSON.stringify(result, null, 2));

    // eslint-disable-next-line no-console
    console.log(
      `[frame-timing run ${run}] frames=${result.framesRendered} fps=${fps.toFixed(2)} ` +
        `p95Interval=${result.frameIntervalMs.p95.toFixed(2)}ms maxInterval=${result.frameIntervalMs.max.toFixed(2)}ms ` +
        `rafCallbackP95=${result.rafCallbackDurationMs.p95.toFixed(3)}ms heapDelta=${result.heap.deltaBytes ?? 'n/a'}`,
    );
  });
}
