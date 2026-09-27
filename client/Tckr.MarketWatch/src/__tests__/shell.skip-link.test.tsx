/**
 * The app shell's skip link (critique 2026-09-26): the first Tab stop on every page,
 * ahead of the logo, landing on the board's current row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    over = document.createElement('div');
    cursor = { idx: null };
    data: [number[], number[]] = [[], []];
  }
  return { default: FakeUPlot };
});

afterEach(cleanup);

describe('shell skip link', () => {
  it('is the first focusable element on the page and lands on a board row', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    await screen.findAllByRole('row', { name: /^[A-Z]+,/ });

    const firstFocusable = document.querySelector<HTMLElement>('a[href], button, input, [tabindex="0"]');
    expect(firstFocusable?.textContent).toBe('Skip to instruments');

    fireEvent.click(firstFocusable!);
    expect(document.activeElement?.getAttribute('data-symbol')).not.toBeNull();
  });
});
