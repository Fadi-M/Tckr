/**
 * Opening a symbol before `StockDetail`'s chunk has loaded (a direct link, or a click
 * before the idle prefetch) shows the pane's skeleton, not a line of "Loading…" text.
 * (That the skeleton keeps the chart out of the entry chunk is `bundle.footprint.test.ts`.)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';

// `App` reaches uPlot through the lazy StockDetail; jsdom can't construct it.
vi.mock('uplot', async () => ({
  default: (await import('../chart/__tests__/uplotTestDouble.ts')).FakeUPlot,
}));

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
    await screen.findByTestId('stock-detail-symbol', undefined, { timeout: 4000 });
    expect(screen.queryByTestId('stock-detail-fallback')).toBeNull();
  });
});
