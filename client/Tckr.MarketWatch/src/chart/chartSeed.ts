import type { ChartHistoryPoint } from './PriceChart.tsx';
import { toPlotValue, type RingBuffer } from './ringBuffer.ts';

/** A single point cannot render a visible line: uPlot needs two x-values to draw a
 * segment, and `points: { show: false }` means there is no marker fallback either. So a
 * lone price gets a synthetic second point one second earlier at the same price, and the
 * first paint is already a (flat) line instead of nothing or a single dot. Used by
 * `seedBuffer` and by `PriceChart`'s "first live price arrives after mount" effect. */
export function seedFlatPoint(buffer: RingBuffer, timeMs: number, price: number): void {
  buffer.push(timeMs - 1000, price);
  buffer.push(timeMs, price);
}

/**
 * Seeds a fresh buffer at mount: the full session `history` first, then the live price
 * `seed` if it is newer than history's last point. A lone point (from either) is doubled
 * with `seedFlatPoint` so the first paint is already a line.
 *
 * History goes in before anything live: the parent page fetches it once and mounts the
 * chart only when it is ready, which is what lets a symbol opened mid-session (e.g. noon,
 * for a 10:00 open) show its whole line immediately instead of only what arrives after
 * this mount.
 */
export function seedBuffer(
  buffer: RingBuffer,
  history: readonly ChartHistoryPoint[] | undefined,
  seed: ChartHistoryPoint | undefined,
): void {
  for (const point of history ?? []) {
    buffer.push(point.t, toPlotValue(point.p));
  }

  if (seed) {
    if (buffer.length === 0) {
      // No history at all (a brand-new symbol, or a history fetch that came back
      // empty) — fall back to the single-point doubling trick.
      seedFlatPoint(buffer, seed.t, toPlotValue(seed.p));
    } else if (seed.t > buffer.times[buffer.length - 1]!) {
      // History's own trailing edge (see `SimulatedSource.getHistory`) is normally
      // already at "now", but append the live price too if it is strictly newer, so a
      // slow history fetch can never leave a visible gap at the right edge of the
      // line.
      buffer.push(seed.t, toPlotValue(seed.p));
    }
  } else if (buffer.length === 1) {
    // Exactly one historical sample exists (the session has just started) — a single
    // point cannot render a visible line, so double it the same way `seedFlatPoint`
    // does for a single live point.
    const onlyT = buffer.times[0]!;
    const onlyV = buffer.values[0]!;
    buffer.clear();
    seedFlatPoint(buffer, onlyT, onlyV);
  }
}
