/**
 * `StockList.navigation.test.tsx` — task 04. Asserts: clicking a row, and pressing
 * Enter on a focused row, both navigate to `/EGX/symbols/<symbol>`. Also covers Space
 * activation, and the table's roving tabindex: one row is a Tab stop, the arrow keys
 * (and Home/End) move between rows, and a focused row becomes the Tab stop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SymbolDefinition } from '../../contracts/rest.ts';
import { resetStore } from '../../data/store.ts';
import { loadUniverseFixture, makeFakeSource } from './testSupport.ts';

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({ getSharedSource: mockGetSharedSource }));

import { StockList } from '../StockList.tsx';

function renderWithRoutes(symbols: readonly SymbolDefinition[]) {
  mockGetSharedSource.mockReturnValue(makeFakeSource(symbols).source);
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<StockList />} />
        <Route path="/EGX/symbols/:symbol" element={<div data-testid="detail-route">detail</div>} />
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

  it('clicking a row navigates to /EGX/symbols/<symbol>', async () => {
    const universeSymbols = loadUniverseFixture();
    renderWithRoutes(universeSymbols);

    await screen.findAllByRole('row');
    // The row's accessible name is now "SYMBOL, price[, direction change%]" (see
    // StockList.tsx's `rowAriaLabel`), not the bare symbol — match on the prefix.
    const row = screen.getByRole('row', { name: /^COMI,/ });
    fireEvent.click(row);

    const detail = await screen.findByTestId('detail-route');
    expect(detail).toBeTruthy();
  });

  it('pressing Enter on a focused row navigates to /EGX/symbols/<symbol>', async () => {
    const universeSymbols = loadUniverseFixture();
    renderWithRoutes(universeSymbols);

    await screen.findAllByRole('row');
    const row = screen.getByRole('row', { name: /^CIB,/ });
    row.focus();
    await waitFor(() => expect(row).toHaveProperty('tabIndex', 0));
    fireEvent.keyDown(row, { key: 'Enter', code: 'Enter' });

    const detail = await screen.findByTestId('detail-route');
    expect(detail).toBeTruthy();
  });

  it('pressing Space on a focused row also navigates', async () => {
    const universeSymbols = loadUniverseFixture();
    renderWithRoutes(universeSymbols);

    await screen.findAllByRole('row');
    const row = screen.getByRole('row', { name: /^ORAS,/ });
    row.focus();
    fireEvent.keyDown(row, { key: ' ', code: 'Space' });

    const detail = await screen.findByTestId('detail-route');
    expect(detail).toBeTruthy();
  });

  it('makes exactly one row a Tab stop, so the table is one stop in the Tab order', async () => {
    const universeSymbols = loadUniverseFixture();
    renderWithRoutes(universeSymbols);

    await screen.findAllByRole('row', { name: /^[A-Z]+,/ });
    const rows = document.querySelectorAll<HTMLTableRowElement>('tbody tr[data-symbol]');
    const tabStops = Array.from(rows).filter((row) => row.tabIndex === 0);
    expect(tabStops).toHaveLength(1);
    expect(tabStops[0]).toBe(rows[0]);
  });

  it('ArrowDown/ArrowUp move focus between rows, Home/End jump to the ends', async () => {
    const universeSymbols = loadUniverseFixture();
    renderWithRoutes(universeSymbols);

    await screen.findAllByRole('row', { name: /^[A-Z]+,/ });
    const rows = Array.from(
      document.querySelectorAll<HTMLTableRowElement>('tbody tr[data-symbol]'),
    );
    rows[0]!.focus();

    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    await waitFor(() => expect(rows[1]).toHaveProperty('tabIndex', 0));
    expect(rows[0]).toHaveProperty('tabIndex', -1);

    fireEvent.keyDown(rows[1]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows[0]);

    fireEvent.keyDown(rows[0]!, { key: 'End' });
    expect(document.activeElement).toBe(rows[rows.length - 1]);

    fireEvent.keyDown(rows[rows.length - 1]!, { key: 'Home' });
    expect(document.activeElement).toBe(rows[0]);
  });
});

describe('StockList split view', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('removes the hero cards from layout in split view (display: none), so they leave the Tab order', async () => {
    const universeSymbols = loadUniverseFixture();
    mockGetSharedSource.mockReturnValue(makeFakeSource(universeSymbols).source);
    render(
      <MemoryRouter initialEntries={['/EGX/symbols/COMI']}>
        <Routes>
          <Route path="/" element={<StockList />}>
            <Route
              path="EGX/symbols/:symbol"
              element={<div data-testid="detail-route">detail</div>}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByTestId('detail-route');
    await screen.findAllByRole('row', { name: /^[A-Z]+,/ });
    // jsdom doesn't apply Tailwind's CSS, so assert the `hidden` (display: none) class
    // on the wrapper holding the hero-card buttons.
    const heroButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button[aria-label]'),
    ).filter((button) =>
      /^(Top gainer|Top loser|Most active)/i.test(button.getAttribute('aria-label') ?? ''),
    );
    expect(heroButtons.length).toBeGreaterThan(0);
    for (const button of heroButtons) {
      expect(button.closest('.hidden')).not.toBeNull();
    }
  });
});
