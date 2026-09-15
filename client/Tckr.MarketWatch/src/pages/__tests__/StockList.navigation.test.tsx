/**
 * `StockList.navigation.test.tsx` — task 04. Asserts: clicking a row, and pressing
 * Enter on a focused row, both navigate to `/symbols/<symbol>`. Also covers Space
 * activation and confirms Tab can reach a row (keyboard-operable).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

function renderWithRoutes(symbols: readonly SymbolDefinition[]) {
  mockGetSharedSource.mockReturnValue(makeFakeSource(symbols));
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<StockList />} />
        <Route path="/symbols/:symbol" element={<div data-testid="detail-route">detail</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('StockList navigation', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('clicking a row navigates to /symbols/<symbol>', async () => {
    const universeSymbols = loadUniverseFixture();
    renderWithRoutes(universeSymbols);

    await screen.findAllByRole('row');
    const row = screen.getByRole('row', { name: 'COMI' });
    fireEvent.click(row);

    const detail = await screen.findByTestId('detail-route');
    expect(detail).toBeTruthy();
  });

  it('pressing Enter on a focused row navigates to /symbols/<symbol>', async () => {
    const universeSymbols = loadUniverseFixture();
    renderWithRoutes(universeSymbols);

    await screen.findAllByRole('row');
    const row = screen.getByRole('row', { name: 'CIB' });
    row.focus();
    expect(row).toHaveProperty('tabIndex', 0);
    fireEvent.keyDown(row, { key: 'Enter', code: 'Enter' });

    const detail = await screen.findByTestId('detail-route');
    expect(detail).toBeTruthy();
  });

  it('pressing Space on a focused row also navigates', async () => {
    const universeSymbols = loadUniverseFixture();
    renderWithRoutes(universeSymbols);

    await screen.findAllByRole('row');
    const row = screen.getByRole('row', { name: 'ORAS' });
    row.focus();
    fireEvent.keyDown(row, { key: ' ', code: 'Space' });

    const detail = await screen.findByTestId('detail-route');
    expect(detail).toBeTruthy();
  });
});
