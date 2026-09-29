/**
 * A search that empties the board is a re-rank to zero rows. The glide must stop the
 * previous flight and do nothing else, not hand GSAP an empty target list (which logs
 * "GSAP target not found" on every such keystroke).
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { resetStore } from '../../data/store.ts';
import {
  primeMotion,
  resetMotion,
  stubReducedMotion,
  unstubReducedMotion,
} from '../../motion/__tests__/motionTestSupport.ts';
import { boardRows, renderBoard } from './testSupport.tsx';

vi.mock('../../data/config.ts');

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
    await renderBoard();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.useFakeTimers();

    fireEvent.change(screen.getByRole('searchbox', { name: /search/i }), {
      target: { value: 'zzzz' },
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(boardRows()).toEqual([]);
    expect(warn.mock.calls.flat().join(' ')).not.toContain('GSAP target');
  });
});
