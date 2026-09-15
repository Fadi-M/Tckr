/**
 * `StockList.search.test.tsx` — task 04. Asserts: typing `com` matches COMI by symbol
 * and matches ETEL ("Egyptian Telecom") by name too; a non-matching query renders the
 * empty state. Debounce is 150ms (fake timers — no `sleep`, per README.md §8).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function bodyRows() {
  return screen.getAllByRole('row').filter((row) => row.hasAttribute('data-symbol'));
}

describe('StockList search', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('matches COMI by symbol and ETEL by name for "com", case-insensitively, after debounce', async () => {
    const universeSymbols = loadUniverseFixture();
    // Sanity-check the fixture actually exercises both match paths this test claims.
    expect(universeSymbols.some((s) => s.symbol === 'COMI')).toBe(true);
    expect(universeSymbols.find((s) => s.symbol === 'ETEL')?.name).toBe('Egyptian Telecom');

    mockGetSharedSource.mockReturnValue(makeFakeSource(universeSymbols));

    render(
      <MemoryRouter>
        <StockList />
      </MemoryRouter>,
    );
    await flushMicrotasks();
    expect(bodyRows()).toHaveLength(34);

    const input = screen.getByRole('searchbox', { name: /search/i });
    fireEvent.change(input, { target: { value: 'com' } });

    // Not yet debounced.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(bodyRows()).toHaveLength(34);

    act(() => {
      vi.advanceTimersByTime(60);
    });

    const symbolsShown = bodyRows().map((row) => row.getAttribute('data-symbol'));
    expect(symbolsShown).toContain('COMI');
    expect(symbolsShown).toContain('ETEL');
    expect(symbolsShown.length).toBeLessThan(34);
  });

  it('renders an explicit "no instruments match" state for a non-matching query', async () => {
    const universeSymbols = loadUniverseFixture();
    mockGetSharedSource.mockReturnValue(makeFakeSource(universeSymbols));

    render(
      <MemoryRouter>
        <StockList />
      </MemoryRouter>,
    );
    await flushMicrotasks();
    expect(bodyRows()).toHaveLength(34);

    const input = screen.getByRole('searchbox', { name: /search/i });
    fireEvent.change(input, { target: { value: 'zzzznotfound' } });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(bodyRows()).toHaveLength(0);
    expect(screen.getByText(/no instruments match/i)).toBeTruthy();
  });
});
