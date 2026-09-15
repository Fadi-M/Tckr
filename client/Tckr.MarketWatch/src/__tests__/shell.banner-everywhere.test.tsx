import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';

// `App` now renders the real `StockDetail` (task 06), which mounts the real
// `PriceChart` (task 05), which constructs a real `uplot`. jsdom has no canvas and no
// `window.matchMedia`, so the real uPlot cannot construct there — fake it, the same
// technique task 05/06's own tests use (e.g. `src/chart/__tests__/uplotTestDouble.ts`,
// `StockDetail.snapshot-first.test.tsx`). This is orthogonal to what this suite
// actually asserts (the banner), so a minimal double is enough. `vi.mock` calls are
// hoisted above imports, so this still takes effect for the `App` import above.
vi.mock('uplot', () => {
  class FakeUPlot {
    setData = vi.fn();
    destroy = vi.fn();
    setSize = vi.fn();
    redraw = vi.fn();
    root = document.createElement('div');
    cursor = { idx: null };
    data: [number[], number[]] = [[], []];
  }
  return { default: FakeUPlot };
});

afterEach(cleanup);

describe('SimulatedBanner appears on every route and cannot be dismissed', () => {
  it.each(['/', '/symbols/COMI'])('shows the simulated-data banner at %s', (path) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );
    const banner = screen.getByRole('status');
    expect(banner.textContent ?? '').toMatch(/simulated market data/i);
    expect(banner.textContent ?? '').toMatch(/fictional instruments/i);
  });

  it('has no button or other control, inside the banner itself, that could dismiss it', () => {
    // Scoped to the banner element: the real pages behind it legitimately have their
    // own buttons (e.g. StockList's column-sort buttons), which is not what this test
    // is about — this test is about the banner having no dismiss affordance.
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    const banner = screen.getByRole('status');
    expect(within(banner).queryAllByRole('button')).toHaveLength(0);
  });
});
