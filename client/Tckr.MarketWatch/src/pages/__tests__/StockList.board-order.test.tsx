/**
 * The table's caption always says what order the board is in (critique 2026-09-26: the
 * default order was unmarked), follows every sort change, and counts matches while a
 * search filters it. Each row also carries a real link to its detail that isn't an extra
 * Tab stop.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { resetStore } from '../../data/store.ts';
import { describeOrder } from '../boardColumns.tsx';
import { boardRows, renderBoard } from './testSupport.tsx';

vi.mock('../../data/config.ts');

describe('describeOrder', () => {
  it('names the default, presets and plain column sorts', () => {
    expect(describeOrder(null)).toBe('Exchange order');
    expect(describeOrder({ column: 'value', direction: 'desc' })).toBe(
      'Most active · Highest traded value (EGP) this session first',
    );
    expect(describeOrder({ column: 'price', direction: 'asc' })).toBe(
      'Sorted by Price, lowest first',
    );
    expect(describeOrder({ column: 'name', direction: 'desc' })).toBe('Sorted by Name, Z–A');
  });
});

describe('StockList order caption', () => {
  beforeEach(resetStore);
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('starts on the exchange order and follows a preset, a header sort and the way back', async () => {
    await renderBoard();
    const caption = screen.getByTestId('board-order');
    expect(caption.textContent).toBe('Exchange order');

    fireEvent.click(screen.getByRole('button', { name: 'Gainers' }));
    expect(caption.textContent).toBe('Gainers · Biggest rise first');

    fireEvent.click(
      within(screen.getByRole('columnheader', { name: /^Price/ })).getByRole('button'),
    );
    expect(caption.textContent).toBe('Sorted by Price, highest first');

    const exchangeOrder = screen.getByRole('button', { name: 'Exchange order' });
    fireEvent.click(exchangeOrder);
    expect(caption.textContent).toBe('Exchange order');
    expect(exchangeOrder.getAttribute('aria-pressed')).toBe('true');
  });

  it('counts the matches while a search filters the board, and announces the count', async () => {
    vi.useFakeTimers();
    await renderBoard();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search symbol or name' }), {
      target: { value: 'bank' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    const matches = boardRows().length;
    expect(screen.getByTestId('board-order').textContent).toBe(`${matches} of 34 · Exchange order`);
    expect(screen.getByTestId('search-result-count').textContent).toBe(
      `${matches} of 34 instruments match “bank”`,
    );
  });

  it('gives each row a real link to its detail that is not an extra Tab stop', async () => {
    await renderBoard();
    const [firstRow] = boardRows();
    const symbol = firstRow!.getAttribute('data-symbol')!;
    const link = within(firstRow!).getByRole('link', { name: `Open ${symbol} details` });
    expect(link.getAttribute('href')).toBe(`/EGX/symbols/${symbol}`);
    expect(link.getAttribute('tabindex')).toBe('-1');
  });
});
