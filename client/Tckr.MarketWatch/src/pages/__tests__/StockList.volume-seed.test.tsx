/**
 * Regression: the board used to start every row's volume at 0 on its first tick after
 * mount, discarding the session's volume so far. It now asks for a snapshot of every
 * instrument on mount (fired, not awaited, so the table still paints at once), and one
 * failed snapshot doesn't stop the others from seeding.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { toDecimal } from '../../contracts/decimal.ts';
import { applySnapshot, primeUniverse, resetStore } from '../../data/store.ts';
import {
  loadUniverseFixture,
  makeFakeSource,
  renderBoard,
  snapshotFixture,
} from './testSupport.tsx';

vi.mock('../../data/config.ts');

describe('StockList volume seeding', () => {
  beforeEach(resetStore);
  afterEach(cleanup);

  it('seeds every instrument’s session volume from its snapshot, even when one snapshot fails', async () => {
    const universe = loadUniverseFixture();
    primeUniverse(universe);
    const fake = makeFakeSource(universe, {
      getSnapshotImpl: (symbol) => {
        if (symbol === 'COMI') return Promise.reject(new Error('snapshot failed'));
        const snapshot = snapshotFixture({ symbol, price: toDecimal('50.00'), volume: 123_456 });
        // Real sources write the snapshot into the store before resolving; the page
        // relies on that rather than applying it itself.
        applySnapshot(snapshot);
        return Promise.resolve(snapshot);
      },
    });

    await renderBoard({ source: fake.source });

    expect([...fake.getSnapshotCalls].sort()).toEqual(universe.map((def) => def.symbol).sort());
    expect(screen.getByRole('row', { name: /^CIB,/ }).textContent).toContain('123,456');
  });
});
