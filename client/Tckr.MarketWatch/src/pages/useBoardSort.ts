/**
 * The board's sort state, split out of `StockList`: the active column and direction (or
 * `null` for exchange order), header-click toggling, and the sorted rows, re-ranked on
 * the display beat while a sort is active.
 */
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import type { SymbolDefinition } from '../contracts/rest.ts';
import { subscribeBeat } from '../display/pacedViews.ts';
import { COLUMNS, compareBy, type SortColumn, type SortState } from './boardColumns.tsx';

export function useBoardSort(filtered: readonly SymbolDefinition[]) {
  const [sortState, setSortState] = useState<SortState | null>(null);

  // `sorted` below reads live snapshot values *imperatively*, only when it recomputes
  // (see module doc: resorting on every tick would reintroduce the whole-table
  // re-render this page exists to avoid, and would make rows jump under the cursor).
  // Left alone, that means an active preset (e.g. "Most active") can show a stale,
  // increasingly-misleading ranking indefinitely between sort clicks/searches, even as
  // every individual row keeps visibly repainting. `resortTick` re-ranks on the price
  // beat itself (`subscribeBeat`), in the same commit as the figures it ranks by, so a
  // sorted board never shows an order its own numbers contradict (a falling row on top
  // of "Gainers"), without resorting on every tick. Mirrors
  // `useConnectionBanner`'s reconnecting-interval: only runs while there is something
  // to keep fresh (`sortState !== null`), and is keyed off that boolean rather than the
  // `SortState` object itself so switching between sort columns doesn't restart the
  // re-rank window.
  const [resortTick, forceResort] = useReducer((n: number) => n + 1, 0);
  const hasActiveSort = sortState !== null;
  useEffect(() => {
    if (!hasActiveSort) {
      return undefined;
    }
    return subscribeBeat(forceResort);
  }, [hasActiveSort]);

  const sorted = useMemo(() => {
    if (!sortState) {
      return filtered;
    }
    const { column, direction } = sortState;
    const factor = direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => factor * compareBy(column, a, b));
    // `resortTick` is intentionally in this array even though the body never reads
    // it — bumping it is exactly what forces this memo to recompute (and re-read live
    // snapshot values via `compareBy`) once per `DISPLAY_REFRESH_INTERVAL_MS`.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resortTick is the recompute trigger (above)
  }, [filtered, sortState, resortTick]);

  const handleSort = useCallback((column: SortColumn) => {
    setSortState((current) => {
      if (!current || current.column !== column) {
        // Figures lead with the biggest (the top price, the heaviest volume), the way a
        // trader reads a ranking; text columns start at A.
        const numeric = COLUMNS.find((candidate) => candidate.key === column)?.numeric === true;
        return { column, direction: numeric ? 'desc' : 'asc' };
      }
      // Toggles between the two directions; never silently drops back to "unsorted" on
      // a third click. The "Exchange order" preset is the named way back.
      return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' };
    });
  }, []);

  return { sortState, setSortState, sorted, handleSort };
}
