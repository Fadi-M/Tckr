/**
 * Opening a symbol before `StockDetail`'s chunk has loaded (a direct link, or a click
 * before the idle prefetch) shows the pane's skeleton, not a line of "Loading…" text.
 * And that skeleton must stay free of the chart: it renders in the entry chunk, so a
 * static path from it to `PriceChart`/uPlot would drag the chart library into the
 * first load.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';

vi.mock('uplot', () => {
  class FakeUPlot {
    setData = vi.fn();
    destroy = vi.fn();
    setSize = vi.fn();
    redraw = vi.fn();
    root = document.createElement('div');
    over = document.createElement('div');
    cursor = { idx: null };
    data: [number[], number[]] = [[], []];
  }
  return { default: FakeUPlot };
});

afterEach(cleanup);

/** Text a sighted user would see: everything except screen-reader-only spans. */
function visibleText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('.sr-only').forEach((node) => node.remove());
  return clone.textContent ?? '';
}

describe('detail pane before its chunk loads', () => {
  it('shows the pane skeleton with the symbol from the URL, and no loading text', async () => {
    render(
      <MemoryRouter initialEntries={['/EGX/symbols/COMI']}>
        <App />
      </MemoryRouter>,
    );
    const fallback = screen.getByTestId('stock-detail-fallback');
    expect(fallback.querySelector('h2')!.textContent).toBe('COMI');
    expect(fallback.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0);
    expect(visibleText(fallback)).not.toMatch(/Loading/);
    expect(visibleText(fallback)).toBe('COMIOpenHighLowVolume');
    // Screen readers still hear that it is loading.
    expect(fallback.textContent).toContain('Loading COMI price');

    // Then the real pane replaces it.
    await screen.findByTestId('stock-detail-symbol');
    expect(screen.queryByTestId('stock-detail-fallback')).toBeNull();
  });

  it('keeps the skeleton modules free of PriceChart and uPlot', () => {
    for (const file of ['pages/detailChrome.tsx', 'chart/ChartSkeleton.tsx', 'chart/chartGeometry.ts', 'components/Skeleton.tsx']) {
      const source = readFileSync(resolve(__dirname, '..', file), 'utf8');
      expect(source, file).not.toMatch(/from\s+['"][^'"]*(PriceChart|uplot)[^'"]*['"]/);
    }
  });
});
