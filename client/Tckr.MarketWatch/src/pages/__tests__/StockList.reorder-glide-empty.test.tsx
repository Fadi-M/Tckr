/**
 * A search that empties the board is a re-rank to zero rows. The glide must stop the
 * previous flight and do nothing else, not hand GSAP an empty target list (which logs
 * "GSAP target not found" on every such keystroke).
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { resetStore } from '../../data/store.ts';
import {
  primeMotion,
  resetMotion,
  stubReducedMotion,
  unstubReducedMotion,
} from '../../motion/__tests__/motionTestSupport.ts';
import { loadUniverseFixture, makeFakeSource } from './testSupport.ts';

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({ getSharedSource: mockGetSharedSource }));

import { StockList } from '../StockList.tsx';

describe('StockList re-rank glide', () => {
  beforeEach(async () => {
    resetStore();
    stubReducedMotion(false);
    await primeMotion();
  });

  afterEach(async () => {
    cleanup();
    await resetMotion();
    unstubReducedMotion();
    vi.useRealTimers();
  });

  it('does not warn when a search leaves no rows', async () => {
    mockGetSharedSource.mockReturnValue(makeFakeSource(loadUniverseFixture()).source);
    render(
      <MemoryRouter>
        <StockList />
      </MemoryRouter>,
    );
    await screen.findAllByRole('row');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.useFakeTimers();

    fireEvent.change(screen.getByRole('searchbox', { name: /search/i }), {
      target: { value: 'zzzz' },
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.queryAllByRole('row').filter((row) => row.hasAttribute('data-symbol'))).toEqual(
      [],
    );
    expect(warn.mock.calls.flat().join(' ')).not.toContain('GSAP target');
  });
});
