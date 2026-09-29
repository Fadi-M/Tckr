/**
 * The board's first paint and its subscription. It shows exactly the 34 instruments of
 * `public/symbols.json` (read from disk, not a hard-coded list), in the exchange's own
 * activity order, each at its reference price, muted and at tick precision, before any
 * tick: never a spinner, never "0.00". It subscribes to all 34 once, unsubscribes the same
 * set on unmount, and never touches the shared connection itself (that belongs to
 * `getSharedSource()`, and StockDetail shares it).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { format } from '../../contracts/decimal.ts';
import { resetStore } from '../../data/store.ts';
import {
  boardRows,
  boardSymbols,
  loadUniverseFixture,
  makeFakeSource,
  renderBoard,
} from './testSupport.tsx';

vi.mock('../../data/config.ts');

const sorted = (symbols: readonly (string | null)[]) => [...symbols].sort();

describe('StockList universe', () => {
  beforeEach(resetStore);
  afterEach(cleanup);

  it('renders the 34 instruments in exchange order, each at its muted reference price', async () => {
    const universe = loadUniverseFixture();
    expect(universe).toHaveLength(34);
    await renderBoard({ source: makeFakeSource(universe).source });

    expect(sorted(boardSymbols())).toEqual(sorted(universe.map((def) => def.symbol)));
    expect(boardSymbols().slice(0, 4)).toEqual(['COMI', 'CIB', 'ORAS', 'SWDY']);

    for (const def of universe) {
      const row = boardRows().find((r) => r.getAttribute('data-symbol') === def.symbol)!;
      const decimals = Math.max(
        def.referencePrice.split('.')[1]?.length ?? 0,
        def.tickSize.split('.')[1]?.length ?? 0,
      );
      const price = format(def.referencePrice, { decimals });
      expect(row.querySelector('[data-muted="true"]')?.textContent, def.symbol).toBe(price);
      expect(row.getAttribute('aria-label')).toMatch(
        new RegExp(`^${def.symbol}, ${def.referencePrice.replace('.', '\\.')}\\b`),
      );
    }
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
  });

  it('subscribes to all 34 once, unsubscribes them on unmount, and never connects or disconnects', async () => {
    const universe = loadUniverseFixture();
    const fake = makeFakeSource(universe);
    const { unmount } = await renderBoard({ source: fake.source });
    const expected = sorted(universe.map((def) => def.symbol));

    expect(fake.subscribe).toHaveBeenCalledTimes(1);
    expect(sorted(fake.subscribe.mock.calls[0]![0] as string[])).toEqual(expected);
    expect(fake.unsubscribe).not.toHaveBeenCalled();

    unmount();

    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
    expect(sorted(fake.unsubscribe.mock.calls[0]![0] as string[])).toEqual(expected);
    expect(fake.connect).not.toHaveBeenCalled();
    expect(fake.disconnect).not.toHaveBeenCalled();
  });
});
