/**
 * The board's search box state, split out of `StockList`: the raw query as typed, the
 * debounced query the list filters by (150 ms, so typing doesn't refilter per keystroke),
 * the filtered universe, and the closest instruments to offer when nothing matches.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SymbolDefinition } from '../contracts/rest.ts';
import { closestInstruments } from './closestInstruments.ts';

export function useBoardSearch(universe: readonly SymbolDefinition[] | null) {
  const [rawQuery, setRawQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(rawQuery), 150);
    return () => clearTimeout(handle);
  }, [rawQuery]);

  const filtered = useMemo(() => {
    if (!universe) {
      return [];
    }
    const query = debouncedQuery.trim().toLowerCase();
    if (query === '') {
      return universe;
    }
    return universe.filter(
      (def) => def.symbol.toLowerCase().includes(query) || def.name.toLowerCase().includes(query),
    );
  }, [universe, debouncedQuery]);

  // Only computed when the search matched nothing (see the empty state).
  const suggestions = useMemo(
    () => (universe && filtered.length === 0 ? closestInstruments(debouncedQuery, universe) : []),
    [universe, filtered.length, debouncedQuery],
  );

  const clearSearch = useCallback(() => setRawQuery(''), []);

  return { rawQuery, setRawQuery, debouncedQuery, filtered, suggestions, clearSearch };
}
