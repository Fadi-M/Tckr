/**
 * `StockList.universe.test.tsx` — task 04 (docs/phase-3-web-client/04-stock-list.md).
 * Asserts: exactly 34 rows; the rendered symbol set equals the set in
 * `public/symbols.json`, read from disk — not a hard-coded list in this test.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toDecimal } from '../../contracts/decimal.ts';
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

/** Reads `public/symbols.json` — the byte-identical copy of the exchange's own
 * universe (task 02) — and shapes it as the `getUniverse()` REST response would.
 * Never a hard-coded list. */
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
    getSnapshot: () => Promise.reject(new Error('StockList.universe.test.tsx: getSnapshot not used')),
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

describe('StockList universe rendering', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders exactly the 34 named instruments from public/symbols.json, and no others', async () => {
    const universeSymbols = loadUniverseFixture();
    expect(universeSymbols).toHaveLength(34);
    mockGetSharedSource.mockReturnValue(makeFakeSource(universeSymbols));

    render(
      <MemoryRouter>
        <StockList />
      </MemoryRouter>,
    );

    const allRows = await screen.findAllByRole('row');
    const bodyRows = allRows.filter((row) => row.hasAttribute('data-symbol'));
    expect(bodyRows).toHaveLength(34);

    const renderedSymbols = new Set(bodyRows.map((row) => row.getAttribute('data-symbol')));
    const expectedSymbols = new Set(universeSymbols.map((def) => def.symbol));
    expect(renderedSymbols).toEqual(expectedSymbols);
  });
});
