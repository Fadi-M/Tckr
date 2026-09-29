/**
 * Board search: case-insensitive on symbol and name after a 150 ms debounce, an explicit
 * empty state for no match, and its own clear button. (A no-match search's suggestions
 * are `StockList.delight.test.tsx`.)
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { resetStore } from '../../data/store.ts';
import { boardRows, boardSymbols, renderBoard } from './testSupport.tsx';

vi.mock('../../data/config.ts');

const searchbox = () => screen.getByRole<HTMLInputElement>('searchbox', { name: /search/i });
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe('StockList search', () => {
  beforeEach(() => {
    resetStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('matches COMI by symbol and ETEL ("Egyptian Telecom") by name for "com", after the debounce', async () => {
    await renderBoard();
    fireEvent.change(searchbox(), { target: { value: 'com' } });

    advance(100);
    expect(boardRows()).toHaveLength(34); // not yet debounced

    advance(60);
    expect(boardSymbols()).toEqual(expect.arrayContaining(['COMI', 'ETEL']));
    expect(boardRows().length).toBeLessThan(34);
  });

  it('says "no instruments match" for a query that matches nothing', async () => {
    await renderBoard();
    fireEvent.change(searchbox(), { target: { value: 'zzzznotfound' } });
    advance(200);
    expect(boardRows()).toHaveLength(0);
    expect(screen.getByText(/no instruments match/i)).toBeTruthy();
  });

  it('shows its clear button only while there is a query, and clearing refocuses the box', async () => {
    await renderBoard();
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    fireEvent.change(searchbox(), { target: { value: 'com' } });

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    advance(200);

    expect(searchbox().value).toBe('');
    expect(document.activeElement).toBe(searchbox());
    expect(boardRows()).toHaveLength(34);
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  });
});
