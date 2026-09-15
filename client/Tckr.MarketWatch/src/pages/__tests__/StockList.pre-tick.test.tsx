/**
 * `StockList.pre-tick.test.tsx` — task 04. Asserts: before any tick, each row shows its
 * `referencePrice` from the universe in the muted style — never a spinner, never
 * `0.00`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { format, toDecimal } from '../../contracts/decimal.ts';
import type { IsoUtc } from '../../contracts/messages.ts';
import type { SymbolDefinition, SymbolUniverseResponse } from '../../contracts/rest.ts';
import type { MarketDataSource } from '../../data/MarketDataSource.ts';
import { resetStore } from '../../data/store.ts';

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({ getSharedSource: mockGetSharedSource }));

import { StockList } from '../StockList.tsx';

const here = dirname(fileURLToPath(import.meta.url));

interface RawSymbol {
  readonly symbol: string;
  readonly name: string;
  readonly referencePrice: number;
  readonly tickSize: number;
  readonly lotSize: number;
}

function loadUniverseFixture(): readonly SymbolDefinition[] {
  const raw = readFileSync(resolve(here, '../../../public/symbols.json'), 'utf-8');
  const parsed = JSON.parse(raw) as { symbols: readonly RawSymbol[] };
  return parsed.symbols.map((s) => ({
    symbol: s.symbol,
    name: s.name,
    currency: 'EGP',
    tickSize: toDecimal(s.tickSize.toString()),
    lotSize: s.lotSize,
    referencePrice: toDecimal(s.referencePrice.toString()),
  }));
}

function makeFakeSource(symbols: readonly SymbolDefinition[]): MarketDataSource {
  return {
    connect: () => Promise.resolve(),
    disconnect: () => {},
    subscribe: () => {},
    unsubscribe: () => {},
    getUniverse: () =>
      Promise.resolve<SymbolUniverseResponse>({
        v: 1,
        asOf: new Date().toISOString() as IsoUtc,
        simulated: true,
        symbols,
      }),
    getSnapshot: () => Promise.reject(new Error('not used')),
    on: {
      tick: () => () => {},
      snapshot: () => () => {},
      status: () => () => {},
      error: () => () => {},
      entitlement: () => () => {},
    },
    identity: () => null,
  };
}

describe('StockList pre-tick display', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows each symbol’s referencePrice, muted, and never "0.00", before any tick', async () => {
    const universeSymbols = loadUniverseFixture();
    mockGetSharedSource.mockReturnValue(makeFakeSource(universeSymbols));

    render(
      <MemoryRouter>
        <StockList />
      </MemoryRouter>,
    );

    const rows = await screen.findAllByRole('row');
    const bodyRows = rows.filter((row) => row.hasAttribute('data-symbol'));
    expect(bodyRows).toHaveLength(34);

    for (const def of universeSymbols) {
      const row = bodyRows.find((r) => r.getAttribute('data-symbol') === def.symbol);
      expect(row).toBeTruthy();
      if (!row) continue;

      const priceCell = row.querySelector('.tckr-price-cell--muted');
      expect(priceCell, `${def.symbol} should render a muted price cell before its first tick`).toBeTruthy();

      const text = priceCell?.textContent ?? '';
      expect(text).not.toBe('0.00');
      expect(text).not.toBe('');

      // The displayed text must be the formatted referencePrice, not an arbitrary
      // placeholder — decimals are picked from `max(referencePrice dp, tickSize dp)`,
      // matching the live-tick precision (`StockList.tsx`'s `decimalPlacesOf`).
      const dot = (s: string) => (s.includes('.') ? s.length - s.indexOf('.') - 1 : 0);
      const decimals = Math.max(dot(def.referencePrice), dot(def.tickSize));
      expect(text).toBe(format(def.referencePrice, { decimals }));
    }

    // No per-row spinner/loading affordance.
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
  });
});
