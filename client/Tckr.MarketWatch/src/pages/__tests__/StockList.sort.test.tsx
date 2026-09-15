/**
 * `StockList.sort.test.tsx` — task 04. Asserts: sorting by price ascending/descending
 * orders via `compare` (decimal-safe), never lexicographically — `9.90` must sort below
 * `85.10`, which a string sort would get backwards (`"85.10" < "9.90"` lexically).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toDecimal } from '../../contracts/decimal.ts';
import type { IsoUtc, Tick } from '../../contracts/messages.ts';
import type { SymbolDefinition, SymbolUniverseResponse } from '../../contracts/rest.ts';
import type { MarketDataSource } from '../../data/MarketDataSource.ts';
import { applyTick, resetStore } from '../../data/store.ts';

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

function makeTick(symbol: string, price: string): Tick {
  return {
    v: 1,
    type: 'tick',
    s: symbol,
    p: toDecimal(price),
    q: 100,
    k: 'TRADE',
    t: '2026-09-12T10:31:04.881Z' as IsoUtc,
    id: 'evt-000000000000002',
    st: 'LIVE',
  };
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function bodyRows() {
  return screen.getAllByRole('row').filter((row) => row.hasAttribute('data-symbol'));
}

describe('StockList sort', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('sorts price ascending/descending using decimal `compare`, not lexicographic order', async () => {
    const universeSymbols = loadUniverseFixture();
    mockGetSharedSource.mockReturnValue(makeFakeSource(universeSymbols));

    render(
      <MemoryRouter>
        <StockList />
      </MemoryRouter>,
    );
    await flushMicrotasks();
    expect(bodyRows()).toHaveLength(34);

    // COMI (default reference price 85.10) is pushed to a low price; SWDY (reference
    // 18.42) to a low-but-different price; ORAS (reference 245.60) stays high. A
    // lexicographic string sort would order "18.90" < "245.60" < "9.90" incorrectly
    // (comparing character by character); decimal `compare` must not.
    act(() => {
      applyTick(makeTick('COMI', '9.90'));
      applyTick(makeTick('SWDY', '18.90'));
    });

    const priceHeader = screen.getByRole('columnheader', { name: /^price/i });
    const sortButton = within(priceHeader).getByRole('button');

    fireEvent.click(sortButton); // ascending
    let symbols = bodyRows().map((row) => row.getAttribute('data-symbol'));
    let indexOf = (s: string) => symbols.indexOf(s);
    expect(indexOf('COMI')).toBeGreaterThanOrEqual(0);
    expect(indexOf('COMI')).toBeLessThan(indexOf('SWDY'));
    expect(indexOf('SWDY')).toBeLessThan(indexOf('ORAS'));

    fireEvent.click(sortButton); // descending
    symbols = bodyRows().map((row) => row.getAttribute('data-symbol'));
    indexOf = (s: string) => symbols.indexOf(s);
    expect(indexOf('ORAS')).toBeLessThan(indexOf('SWDY'));
    expect(indexOf('SWDY')).toBeLessThan(indexOf('COMI'));
  });
});
