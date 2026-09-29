/**
 * The detail pane while its snapshot and history are in flight: skeleton shapes where
 * the price block, chart and stat values will land, never a figure. A skeleton stands
 * in for layout, not data, so no digit may appear in it (a placeholder price would be a
 * price that never traded), assistive technology hears "Loading" in words, and the stat
 * tiles' labels (known before any figure) are already there.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { resetStore } from '../../data/store.ts';
import { createFakeSource, renderDetail, snapshotFixture } from './testSupport.tsx';

vi.mock('uplot', async () => ({
  default: (await import('../../chart/__tests__/uplotTestDouble.ts')).FakeUPlot,
}));
vi.mock('../../data/config.ts');

import { StockDetail } from '../StockDetail.tsx';

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderInFlight() {
  const { source } = createFakeSource({
    snapshotImpl: (symbol) =>
      new Promise((resolve) => setTimeout(() => resolve(snapshotFixture({ symbol })), 50)),
    historyImpl: (symbol) =>
      new Promise((resolve) => setTimeout(() => resolve({ v: 1, symbol, points: [] }), 50)),
  });
  return renderDetail(<StockDetail symbol="COMI" />, source, { settleFirst: false });
}

describe('StockDetail loading skeleton', () => {
  it('draws the price block, chart and stat values as shapes, with no figure anywhere', async () => {
    const { container } = await renderInFlight();
    const priceBlock = screen.getByTestId('stock-detail-loading');
    const chart = screen.getByTestId('stock-detail-chart-loading');
    const tiles = screen.getByTestId('stock-detail-footer-loading');

    expect(priceBlock.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0);
    expect(chart.querySelector('[data-testid="price-chart-skeleton"]')).toBeTruthy();
    expect(tiles.querySelectorAll('[data-skeleton]')).toHaveLength(4);
    // No digit is painted in any stand-in (the range pills' "60S"/"5M" are controls,
    // not data, and sit outside these regions).
    for (const region of [priceBlock, chart, tiles]) {
      expect(region.textContent).not.toMatch(/\d/);
    }
    expect(container.querySelector('[data-testid="stock-detail-price"]')).toBeNull();
  });

  it('says it is loading in words, and keeps the shapes out of the accessibility tree', async () => {
    await renderInFlight();
    expect(screen.getByTestId('stock-detail-loading').textContent).toContain('Loading COMI price');
    expect(screen.getByTestId('stock-detail-chart-loading').textContent).toContain('Loading chart');
    for (const shape of document.querySelectorAll(
      '[data-skeleton], [data-testid="price-chart-skeleton"]',
    )) {
      expect(shape.closest('[aria-hidden="true"]')).toBeTruthy();
    }
  });

  it('keeps the stat tiles (labels included) in place and swaps only their values when the quote lands', async () => {
    await renderInFlight();
    const tilesBefore = screen.getByTestId('stock-detail-footer-loading');
    expect(tilesBefore.textContent).toBe('OpenHighLowVolume');

    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
      await Promise.resolve();
    });

    const tilesAfter = screen.getByTestId('stock-detail-footer');
    expect(tilesAfter).toBe(tilesBefore);
    expect(tilesAfter.querySelectorAll('[data-skeleton]')).toHaveLength(0);
    expect(screen.queryByTestId('stock-detail-loading')).toBeNull();
  });
});
