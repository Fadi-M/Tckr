/**
 * Fixed-capacity, allocation-free ring buffer for one chart series (task 05,
 * docs/phase-3-web-client/05-price-chart.md). Two `Float64Array`s are pre-allocated at
 * construction and written in place forever; `push` never allocates and the buffer never
 * grows. When full, the oldest point is dropped to make room for the newest — this is
 * the browser-side analogue of the unbounded-queue ban the master context applies
 * server-side (a tab left open on a hot symbol for an hour must not grow without bound).
 *
 * `times`/`values` are always readable as a contiguous, oldest-to-newest run of
 * `length` points starting at index 0. Once the buffer is full, a push shifts the
 * existing contents left by one slot with `TypedArray.prototype.copyWithin` — an
 * in-place memmove, not a reallocation — and writes the new point at the end. The
 * returned array *references* therefore never change across the buffer's lifetime
 * (see `ringBuffer.no-alloc.test.ts`), which is exactly what lets `PriceChart` hand the
 * same views straight to `uPlot.setData` every frame.
 *
 * This module is the **one place a price becomes a JS `number`** within `src/chart/**`
 * (see `toPlotValue` below and the module doc in `PriceChart.tsx`). `push` itself only
 * ever receives a `number` it does not construct. `chart.formatting.test.ts` enforces a
 * narrower, precise version of that claim with a grep check: `Number(`/`parseFloat(`
 * called on a *price-shaped* argument (source text containing "price", case-insensitive
 * — e.g. `Number(price)`, `parseFloat(snapshot.price)`) must not appear anywhere under
 * `src/` outside this file's own `toPlotValue` definition below — every other call site
 * that needs a price as a plotting/decoration number (e.g. `StockList.tsx`'s per-row
 * sparkline) must call `toPlotValue` itself rather than inline its own conversion. That
 * check is deliberately scoped to *price-shaped* arguments, not a blanket ban on
 * `Number(`/`parseFloat(` across the whole codebase — both appear elsewhere for
 * genuinely non-price values (`marketCalendar.ts`'s calendar-component parsing,
 * `contracts/messages.ts`'s `requireNumber` for integer wire fields like `volume`), and
 * a text-level grep has no way to (nor should it try to) forbid those.
 */
import type { DecimalString } from '../contracts/decimal.ts';

export class RingBuffer {
  readonly times: Float64Array;
  readonly values: Float64Array;

  private readonly capacity: number;
  private count = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(`RingBuffer capacity must be a positive integer, got ${capacity}`);
    }
    this.capacity = capacity;
    this.times = new Float64Array(capacity);
    this.values = new Float64Array(capacity);
  }

  /** Number of valid points currently held, oldest-to-newest at indices `[0, length)`.
   * Always `<= capacity`. */
  get length(): number {
    return this.count;
  }

  /** Appends one point. Never allocates: while there is spare capacity the point is
   * written past the current end; once full, the buffer shifts left in place (dropping
   * the oldest point) and the new point becomes the last slot. */
  push(timeMs: number, price: number): void {
    if (this.count < this.capacity) {
      this.times[this.count] = timeMs;
      this.values[this.count] = price;
      this.count += 1;
      return;
    }
    this.times.copyWithin(0, 1);
    this.values.copyWithin(0, 1);
    this.times[this.capacity - 1] = timeMs;
    this.values[this.capacity - 1] = price;
  }

  /**
   * Drops every point in place: `length` goes to 0, `times`/`values` still `subarray(0,
   * 0)` to an empty (but never reallocated) view. No allocation, no shifting — the
   * stale slots beyond the new `length` simply stop being part of any returned view.
   *
   * This exists for one correctness reason, not as general buffer hygiene:
   * client-contract.md §3.3 requires that when the server moves a client between LIVE
   * and DELAYED, old-stream points are discarded rather than left on the same series
   * as new-stream points — mixing the two on one chart is the failure the whole system
   * exists to prevent. `PriceChart` calls this on `store.ts`'s `onStreamDiscard` signal
   * (fired by `resetStream()`) so the chart restarts empty for the new stream.
   */
  clear(): void {
    this.count = 0;
  }
}

/**
 * The sole, deliberate string-to-number conversion in `src/chart/**` — the "plotting
 * boundary" the brief calls out: uPlot draws pixels from numbers and there is no way
 * around that, but the converted value is used **only** for `RingBuffer` storage and
 * chart geometry. Every value the user actually reads (axis labels via `axes.ts`, the
 * crosshair readout, the header) is produced by formatting a `DecimalString` through
 * `contracts/decimal.ts`, never by reading this number back out as text.
 */
export function toPlotValue(price: DecimalString): number {
  return Number(price);
}
