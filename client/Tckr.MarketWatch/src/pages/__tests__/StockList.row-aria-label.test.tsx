/**
 * A row is the focus target, so its `aria-label` is all a screen-reader user gets: the
 * symbol, price, direction in words and the signed change, never the bare symbol. (The
 * pre-tick label is `StockList.universe.test.tsx`.)
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { toDecimal } from '../../contracts/decimal.ts';
import { applyTick, primeUniverse, resetStore } from '../../data/store.ts';
import { beatNowForTests } from '../../display/pacedViews.ts';
import { loadUniverseFixture, renderBoard, tickFixture } from './testSupport.tsx';

vi.mock('../../data/config.ts');

describe('StockList row aria-label', () => {
  beforeEach(() => {
    resetStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // COMI's reference price is 85.10 (public/symbols.json).
  it.each([
    ['90.00', /^COMI, 90(\.0+)?, up \d+(\.\d+)?%, change \+4\.90, volume [\d,]+$/],
    ['10.00', /^COMI, 10(\.0+)?, down \d+(\.\d+)?%, change -75\.10, volume [\d,]+$/],
  ])('names price, direction and change after a tick to %s', async (price, label) => {
    primeUniverse(loadUniverseFixture());
    await renderBoard();

    act(() => {
      applyTick(tickFixture({ s: 'COMI', p: toDecimal(price) }));
      beatNowForTests(); // rows repaint on the page's beat
    });

    expect(screen.getByRole('row', { name: label })).toBeTruthy();
  });
});
