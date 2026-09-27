/**
 * Shared bounded-sparkline logic for `StockList.tsx`'s two independent decorative
 * sparklines (`HeroCard`'s and `StockListRow`'s) — a small hook file living next to
 * its consumers, matching `src/components/useMarketStatus.ts`'s placement precedent
 * (a hook lives beside the page(s)/component(s) that use it, not in a generic
 * `hooks/` folder).
 *
 * `HeroCard` and `StockListRow` each independently kept a `useRef<number[]>` history
 * array, a `useEffect` that pushes the latest plotted value and truncates it (to a
 * different cap each — 26 vs. 20 points), plus the same "append the current value on
 * read if the commit effect hasn't run yet" reconciliation. That reconciliation exists
 * because the ref is mutated in a `useEffect` (committed *after* render, so a
 * mid-render read sees last render's history) rather than during render itself — the
 * same "commit after render, guard on the value actually changing" shape `PriceCell`
 * already uses for its flash animation, so this stays StrictMode-safe (a
 * double-invoked effect still only pushes once per distinct value, since the guard
 * compares against the ref's own last entry, not a render-scoped variable).
 */
import { useEffect, useMemo, useRef } from 'react';

/** Returns a bounded (`maxPoints`-capped) history of `currentValue`, appending a new
 * point only when `currentValue` actually changes. The returned array always ends
 * with `currentValue` — including on the very render a new value first arrives,
 * before this render's commit effect has had a chance to push it into the ref. */
export function useBoundedSparkline(currentValue: number, maxPoints: number): readonly number[] {
  const historyRef = useRef<number[]>([]);
  useEffect(() => {
    const last = historyRef.current[historyRef.current.length - 1];
    if (last !== currentValue) {
      historyRef.current = [...historyRef.current, currentValue].slice(-maxPoints);
    }
  }, [currentValue, maxPoints]);
  return historyRef.current[historyRef.current.length - 1] === currentValue
    ? historyRef.current
    : [...historyRef.current, currentValue];
}

/** `up`/`down`/`flat` direction from a `changePercent` — shared by every sparkline
 * (and, before this extraction, independently re-derived identically by `HeroCard` and
 * `StockListRow`). `undefined` (no snapshot yet) and exactly `0` both read as `flat`. */
export function sparklineDirection(changePercent: number | undefined): 'up' | 'down' | 'flat' {
  return changePercent === undefined || changePercent === 0 ? 'flat' : changePercent > 0 ? 'up' : 'down';
}

/**
 * Reduces a session's full price history to `maxPoints` points — first and last kept
 * exactly — so a row's sparkline can show the whole session's shape from first paint
 * instead of starting flat and filling in one repaint (30s) at a time. Each point in
 * between is the *mean* of its slice of the session, not one sampled tick: picking
 * single ticks out of a noisy tape kept the noise (critique 2026-09-27: the lines read
 * as texture, not trend), while averaging keeps the session's shape.
 * Decorative only, like every sparkline value: never rendered as text.
 */
export function downsampleSeries(values: readonly number[], maxPoints: number): number[] {
  if (values.length <= maxPoints) {
    return [...values];
  }
  const inner = values.length - 2;
  const buckets = maxPoints - 2;
  const means = Array.from({ length: buckets }, (_, i) => {
    const start = 1 + Math.floor((i * inner) / buckets);
    const end = 1 + Math.floor(((i + 1) * inner) / buckets);
    let sum = 0;
    for (let j = start; j < end; j++) {
      sum += values[j]!;
    }
    return sum / (end - start);
  });
  return [values[0]!, ...means, values[values.length - 1]!];
}

/**
 * The sparkline a row or hero card draws: once `sessionSeries` (the symbol's full
 * session history, fetched once by `StockList`) has loaded, its downsampled shape with
 * the live price as the last point — the whole session from first paint. Until then,
 * the bounded live history (`useBoundedSparkline`) stands in.
 */
export function useSessionSparkline(
  currentValue: number,
  maxPoints: number,
  sessionSeries: readonly number[] | undefined,
): readonly number[] {
  const live = useBoundedSparkline(currentValue, maxPoints);
  const seeded = useMemo(
    () => (sessionSeries && sessionSeries.length > 1 ? downsampleSeries(sessionSeries, maxPoints).slice(0, -1) : null),
    [sessionSeries, maxPoints],
  );
  return seeded ? [...seeded, currentValue] : live;
}
