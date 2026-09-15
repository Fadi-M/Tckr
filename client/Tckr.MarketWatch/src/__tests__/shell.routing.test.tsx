import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';

// See shell.banner-everywhere.test.tsx: `App` now reaches real `PriceChart` /
// `uplot` via `StockDetail`, which jsdom cannot construct (no canvas, no
// `matchMedia`). `vi.mock` is hoisted above the `App` import above.
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

describe('routing', () => {
  it('renders the real StockList page at /', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    // The list loads its universe asynchronously (`Loading instruments…` first),
    // so assert on the page's own content rather than on a synchronous marker.
    await screen.findByPlaceholderText('Search symbol or name');
    expect(document.querySelector('.tckr-detail')).toBeNull();
  });

  it('renders the real StockDetail page with symbol="COMI" at /symbols/COMI', () => {
    render(
      <MemoryRouter initialEntries={['/symbols/COMI']}>
        <App />
      </MemoryRouter>,
    );
    const symbolNode = document.querySelector('.tckr-detail__symbol');
    expect(symbolNode?.textContent).toBe('COMI');
  });

  it('redirects an unknown path to /', async () => {
    render(
      <MemoryRouter initialEntries={['/nonsense']}>
        <App />
      </MemoryRouter>,
    );
    await screen.findByPlaceholderText('Search symbol or name');
  });
});
