/**
 * `StockList.navigation.test.tsx` — task 04. Asserts: clicking a row, and pressing
 * Enter on a focused row, both navigate to `/symbols/<symbol>`. Also covers Space
 * activation and confirms Tab can reach a row (keyboard-operable).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    // The row's accessible name is now "SYMBOL, price[, direction change%]" (see
    // StockList.tsx's `rowAriaLabel`), not the bare symbol — match on the prefix.
    const row = screen.getByRole('row', { name: /^COMI,/ });
    fireEvent.click(row);

    const detail = await screen.findByTestId('detail-route');
    expect(detail).toBeTruthy();
  });

  it('pressing Enter on a focused row navigates to /symbols/<symbol>', async () => {
    const universeSymbols = loadUniverseFixture();
    renderWithRoutes(universeSymbols);

    await screen.findAllByRole('row');
    const row = screen.getByRole('row', { name: /^CIB,/ });
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
    const row = screen.getByRole('row', { name: /^ORAS,/ });
    row.focus();
    fireEvent.keyDown(row, { key: ' ', code: 'Space' });

    const detail = await screen.findByTestId('detail-route');
    expect(detail).toBeTruthy();
  });
});
