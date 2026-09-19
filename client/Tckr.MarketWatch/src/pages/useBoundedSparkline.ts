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
import { useEffect, useRef } from 'react';

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
