/**
 * `StockList.search.test.tsx` — task 04. Asserts: typing `com` matches COMI by symbol
 * and matches ETEL ("Egyptian Telecom") by name too; a non-matching query renders the
 * empty state. Debounce is 150ms (fake timers — no `sleep`, per README.md §8).
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { resetStore } from '../../data/store.ts';
import { loadUniverseFixture, makeFakeSource } from './testSupport.ts';

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({ getSharedSource: mockGetSharedSource }));

import { StockList } from '../StockList.tsx';

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

    mockGetSharedSource.mockReturnValue(makeFakeSource(universeSymbols).source);

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
    mockGetSharedSource.mockReturnValue(makeFakeSource(universeSymbols).source);

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
