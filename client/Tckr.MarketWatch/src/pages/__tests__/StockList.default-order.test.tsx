/**
 * `StockList.default-order.test.tsx` — task 04. Asserts: the default order (no column
 * sort applied) is the exchange's own `weight`-descending activity order — the first
 * four rows are COMI, CIB, ORAS, SWDY.
 *
 * `SymbolDefinition` (the frozen `client-contract.md` §2 shape returned by
 * `getUniverse()`) carries no `weight` field — see "Notes for other tasks". This test
 * relies on the documented, verified invariant that `public/symbols.json` — and
 * therefore `getUniverse()`'s response array, which preserves that file's order — is
 * already sorted by `weight` descending; the default (unsorted) render order is simply
 * that array order.
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
  readonly weight: number;
}

function loadUniverseFixture(): { symbols: readonly SymbolDefinition[]; weights: readonly number[] } {
  const raw = readFileSync(resolve(here, '../../../public/symbols.json'), 'utf-8');
  const parsed = JSON.parse(raw) as { symbols: readonly RawSymbol[] };
  return {
    symbols: parsed.symbols.map((s) => ({
      symbol: s.symbol,
      name: s.name,
      currency: 'EGP',
      tickSize: toDecimal(s.tickSize.toString()),
      lotSize: s.lotSize,
      referencePrice: toDecimal(s.referencePrice.toString()),
    })),
    weights: parsed.symbols.map((s) => s.weight),
  };
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

function bodyRows() {
  return screen.getAllByRole('row').filter((row) => row.hasAttribute('data-symbol'));
}

describe('StockList default order', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('public/symbols.json is itself weight-descending (precondition for this test)', () => {
    const { weights } = loadUniverseFixture();
    for (let i = 0; i + 1 < weights.length; i += 1) {
      expect(weights[i]).toBeGreaterThanOrEqual(weights[i + 1] as number);
    }
  });

  it('renders COMI, CIB, ORAS, SWDY first, with no sort applied', async () => {
    const { symbols } = loadUniverseFixture();
    mockGetSharedSource.mockReturnValue(makeFakeSource(symbols));

    render(
      <MemoryRouter>
        <StockList />
      </MemoryRouter>,
    );

    await screen.findAllByRole('row');
    const rows = bodyRows();
    const renderedSymbols = rows.map((row) => row.getAttribute('data-symbol'));

    expect(renderedSymbols.slice(0, 4)).toEqual(['COMI', 'CIB', 'ORAS', 'SWDY']);
  });
});
