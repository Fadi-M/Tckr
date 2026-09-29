/**
 * Keyboard paths in and out of the split detail (critique 2026-09-26): Escape closes the
 * open detail and returns focus to its row, ↑/↓ with the detail open steps it to the next
 * instrument, the phone previous/next buttons do the same, "/" focuses search, and the
 * keyboard model is described to screen readers. (The skip link is the shell's:
 * `SkipLink.test.tsx`, `shell.skip-link.test.tsx`.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { resetStore } from '../../data/store.ts';
import { boardRows, boardSymbols, renderBoard } from './testSupport.tsx';

vi.mock('../../data/config.ts');

const openAt = (symbol: string) => renderBoard({ history: [`/EGX/symbols/${symbol}`] });
const detailSymbol = () => screen.getByTestId('detail-route').textContent;

describe('StockList keyboard paths around the detail pane', () => {
  beforeEach(resetStore);
  afterEach(cleanup);

  it('Escape closes the open detail and puts focus back on its row', async () => {
    await openAt('CIB');

    fireEvent.keyDown(document.body, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByTestId('detail-route')).toBeNull());
    await waitFor(() => expect(document.activeElement?.getAttribute('data-symbol')).toBe('CIB'));
  });

  it('Escape inside the search box leaves the detail open', async () => {
    await openAt('CIB');
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    expect(detailSymbol()).toBe('CIB');
  });

  it('with the detail open, ArrowDown moves focus and the detail to the next row', async () => {
    await openAt('COMI');
    const rows = boardRows();
    const comi = boardSymbols().indexOf('COMI');
    const next = boardSymbols()[comi + 1];

    rows[comi]!.focus();
    fireEvent.keyDown(rows[comi]!, { key: 'ArrowDown' });

    expect(document.activeElement?.getAttribute('data-symbol')).toBe(next);
    await waitFor(() => expect(detailSymbol()).toBe(next));
  });

  it('the phone previous/next buttons step the detail through the board order', async () => {
    await openAt('COMI');
    const next = boardSymbols()[boardSymbols().indexOf('COMI') + 1]!;

    fireEvent.click(screen.getByRole('button', { name: `Next: ${next}` }));
    await waitFor(() => expect(detailSymbol()).toBe(next));

    fireEvent.click(screen.getByRole('button', { name: 'Previous: COMI' }));
    await waitFor(() => expect(detailSymbol()).toBe('COMI'));
  });

  it('"/" focuses the search box from the board, but is typed normally inside a field', async () => {
    await renderBoard();
    const [firstRow] = boardRows();
    const search = screen.getByRole('searchbox');

    firstRow!.focus();
    expect(fireEvent.keyDown(firstRow!, { key: '/' })).toBe(false); // default prevented
    expect(document.activeElement).toBe(search);
    expect(fireEvent.keyDown(search, { key: '/' })).toBe(true); // reaches the input
  });

  it('describes the keyboard model to screen readers, including Escape once the detail is open', async () => {
    await openAt('COMI');
    const table = screen.getByRole('grid', { name: 'Instruments' });
    const help = document.getElementById(table.getAttribute('aria-describedby')!);
    expect(help?.textContent).toMatch(/Arrow keys move between instruments/);
    expect(help?.textContent).toMatch(/Escape closes them/);
  });
});
