/**
 * `StockList.board-order.test.tsx` — the table's caption always says what order the
 * board is in (critique 2026-09-26: the default order was unmarked — no pill and no
 * header arrow lit), and follows every sort change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { resetStore } from '../../data/store.ts';
import { loadUniverseFixture, makeFakeSource } from './testSupport.ts';

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({ getSharedSource: mockGetSharedSource }));

import { describeOrder, StockList } from '../StockList.tsx';

describe('describeOrder', () => {
  it('names the default, presets and plain column sorts', () => {
    expect(describeOrder(null)).toBe('Exchange order');
    expect(describeOrder({ column: 'value', direction: 'desc' })).toBe('Most active · Highest traded value (EGP) this session first');
    expect(describeOrder({ column: 'price', direction: 'asc' })).toBe('Sorted by Price, lowest first');
    expect(describeOrder({ column: 'name', direction: 'desc' })).toBe('Sorted by Name, Z–A');
  });
});

describe('StockList order caption', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
  });

  afterEach(cleanup);

  it('starts on the exchange order and follows a preset and a header sort', async () => {
    mockGetSharedSource.mockReturnValue(makeFakeSource(loadUniverseFixture()).source);
    render(
      <MemoryRouter>
        <StockList />
      </MemoryRouter>,
    );
    await screen.findAllByRole('row', { name: /^[A-Z]+,/ });
    const caption = screen.getByTestId('board-order');
    expect(caption.textContent).toBe('Exchange order');

    fireEvent.click(screen.getByRole('button', { name: 'Gainers' }));
    expect(caption.textContent).toBe('Gainers · Biggest rise since the open first');

    fireEvent.click(within(screen.getByRole('columnheader', { name: /^Price/ })).getByRole('button'));
    expect(caption.textContent).toBe('Sorted by Price, highest first');

    // "Exchange order" is a lit preset: the named way back from any sort.
    fireEvent.click(screen.getByRole('button', { name: 'Exchange order' }));
    expect(caption.textContent).toBe('Exchange order');
    expect(screen.getByRole('button', { name: 'Exchange order' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('counts the matches while a search filters the board, and announces the count', async () => {
    mockGetSharedSource.mockReturnValue(makeFakeSource(loadUniverseFixture()).source);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <MemoryRouter>
        <StockList />
      </MemoryRouter>,
    );
    await screen.findAllByRole('row', { name: /^[A-Z]+,/ });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search symbol or name' }), { target: { value: 'bank' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    const matches = screen.getAllByRole('row', { name: /^[A-Z]+,/ }).length;
    expect(screen.getByTestId('board-order').textContent).toBe(`${matches} of 34 · Exchange order`);
    expect(screen.getByTestId('search-result-count').textContent).toBe(`${matches} of 34 instruments match “bank”`);
    vi.useRealTimers();
  });
});

describe('StockList row link', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
  });

  afterEach(cleanup);

  it('gives each row a real link to its detail that is not an extra Tab stop', async () => {
    mockGetSharedSource.mockReturnValue(makeFakeSource(loadUniverseFixture()).source);
    render(
      <MemoryRouter>
        <StockList />
      </MemoryRouter>,
    );
    const [firstRow] = await screen.findAllByRole('row', { name: /^[A-Z]+,/ });
    const symbol = firstRow!.getAttribute('data-symbol')!;
    const link = within(firstRow!).getByRole('link', { name: `Open ${symbol} details` });
    expect(link.getAttribute('href')).toBe(`/EGX/symbols/${symbol}`);
    expect(link.getAttribute('tabindex')).toBe('-1');
  });
});
