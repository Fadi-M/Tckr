/**
 * The search-first keyboard path (critique 2026-09-27): Enter in search opens the typed
 * ticker, ↓ from search lands on the first row, the sortable headers are one Tab stop
 * moved along with ←/→, and arrowing through rows with a symbol open replaces the history
 * entry instead of adding one per row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { resetStore } from '../../data/store.ts';
import { boardRows, boardSymbols, pressBack, renderBoard } from './testSupport.tsx';

vi.mock('../../data/config.ts');

const detailSymbol = () => screen.getByTestId('detail-route').textContent;

describe('StockList search-first keyboard path', () => {
  beforeEach(resetStore);
  afterEach(cleanup);

  it('Enter in search opens the ticker typed', async () => {
    await renderBoard();
    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'swdy' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(detailSymbol()).toBe('SWDY'));
  });

  it('ArrowDown in search moves focus to the first row', async () => {
    await renderBoard();
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(boardRows()[0]);
  });

  it('the sortable headers are a single Tab stop, moved along with the arrow keys', async () => {
    await renderBoard();
    const headerButtons = screen
      .getAllByRole('columnheader')
      .flatMap((th) => Array.from(th.querySelectorAll('button')));
    const stops = headerButtons.filter((button) => button.tabIndex === 0);
    expect(stops).toHaveLength(1);

    stops[0]!.focus();
    fireEvent.keyDown(stops[0]!, { key: 'ArrowRight' });
    expect(document.activeElement).not.toBe(stops[0]);
    expect(headerButtons).toContain(document.activeElement);
  });

  it('arrowing through rows with a symbol open does not add a history entry per row', async () => {
    await renderBoard({ history: ['/', '/EGX/symbols/COMI'] });
    const symbols = boardSymbols();
    const comi = symbols.indexOf('COMI');
    boardRows()[comi]!.focus();

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    await waitFor(() => expect(detailSymbol()).toBe(symbols[comi + 1]));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    await waitFor(() => expect(detailSymbol()).toBe(symbols[comi + 2]));

    // One Back leaves the pane, rather than stepping back through each row passed.
    pressBack();
    await waitFor(() => expect(screen.queryByTestId('detail-route')).toBeNull());
  });
});
