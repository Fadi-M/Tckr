import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';

// See shell.banner-everywhere.test.tsx: importing `App` transitively imports real
// `uplot` via `StockDetail`/`PriceChart`, which jsdom cannot construct. `vi.mock` is
// hoisted above the `App` import above.
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

describe('header slots', () => {
  it('renders nodes passed as statusSlot and badgeSlot inside the header', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App
          statusSlot={<span data-testid="status-slot-content">connected</span>}
          badgeSlot={<span data-testid="badge-slot-content">LIVE</span>}
        />
      </MemoryRouter>,
    );

    const header = document.querySelector('header.tckr-header');
    expect(header).not.toBeNull();

    const statusNode = screen.getByTestId('status-slot-content');
    const badgeNode = screen.getByTestId('badge-slot-content');
    expect(header?.contains(statusNode)).toBe(true);
    expect(header?.contains(badgeNode)).toBe(true);
  });

  it('renders the header with empty slots when none are passed', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    expect(document.querySelector('header.tckr-header')).not.toBeNull();
  });
});
