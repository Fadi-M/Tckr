/**
 * Opening an instrument from the board, by pointer or keyboard, and the table's roving
 * tabindex: one row is the Tab stop, the arrow keys (and Home/End) move between rows
 * without opening anything.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { resetStore } from '../../data/store.ts';
import { boardRows, renderBoard } from './testSupport.tsx';

vi.mock('../../data/config.ts');

describe('StockList navigation', () => {
  beforeEach(resetStore);
  afterEach(cleanup);

  it.each([
    ['clicking', (row: HTMLElement) => fireEvent.click(row)],
    ['Enter on', (row: HTMLElement) => fireEvent.keyDown(row, { key: 'Enter', code: 'Enter' })],
    ['Space on', (row: HTMLElement) => fireEvent.keyDown(row, { key: ' ', code: 'Space' })],
  ])('%s a row opens /EGX/symbols/<symbol>', async (_how, activate) => {
    await renderBoard();
    const row = screen.getByRole('row', { name: /^CIB,/ });
    row.focus();
    activate(row);
    expect((await screen.findByTestId('detail-route')).textContent).toBe('CIB');
  });

  it('makes the first row the one Tab stop, and moves it with the arrows, Home and End', async () => {
    await renderBoard();
    const rows = boardRows();
    expect(rows.filter((row) => row.tabIndex === 0)).toEqual([rows[0]]);

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

    expect(screen.queryByTestId('detail-route')).toBeNull(); // moving focus opens nothing
  });

  it('removes the hero cards from layout in split view, so they leave the Tab order', async () => {
    await renderBoard({ history: ['/EGX/symbols/COMI'] });
    // jsdom applies no Tailwind CSS, so check for the `hidden` (display: none) wrapper.
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
