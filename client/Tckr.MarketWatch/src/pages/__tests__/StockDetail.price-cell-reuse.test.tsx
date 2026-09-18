import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { resetStore } from '../../data/store.ts';
import { createFakeSource } from './testSupport.ts';

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

vi.mock('../../data/config.ts', () => ({
  getSharedSource: vi.fn(),
  resetSharedSource: vi.fn(),
  resolveClientConfig: vi.fn(() => ({
    source: 'simulated' as const,
    gatewayUrl: 'ws://localhost:5000',
    demoUser: 'user-001',
    simulated: { eventsPerSecond: 2000, delayedOffsetMs: 15000, seed: 1 },
  })),
}));

// Spies on the real `PriceCell` so "every price is rendered by PriceCell" can be
// asserted by component (which component rendered a given value), not by scraping
// text out of the DOM and hoping it lines up.
vi.mock('../../components/PriceCell.tsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/PriceCell.tsx')>();
  return {
    ...actual,
    PriceCell: vi.fn((props: Parameters<typeof actual.PriceCell>[0]) => <actual.PriceCell {...props} />),
  };
});

import { getSharedSource, resetSharedSource } from '../../data/config.ts';
import { PriceCell } from '../../components/PriceCell.tsx';
import { StockDetail } from '../StockDetail.tsx';

afterEach(cleanup);

beforeEach(() => {
  resetStore();
  resetSharedSource();
});

describe('StockDetail renders every price through PriceCell', () => {
  it('routes price, change, open, high, low and tick size through the PriceCell component', async () => {
    const { source } = createFakeSource();
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(
      <MemoryRouter>
        <StockDetail symbol="COMI" />
      </MemoryRouter>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Sanity: the page actually reached the ready state with the footer stats shown.
    expect(screen.getByTestId('stock-detail-price')).toBeTruthy();
    expect(screen.getByTestId('stock-detail-footer')).toBeTruthy();

    const renderedValues = vi.mocked(PriceCell).mock.calls.map((call) => String(call[0]?.value ?? ''));

    // Every DecimalString value shown on the page — price, change, open, high, low,
    // tick size — must have gone through PriceCell (by component, not by string).
    expect(renderedValues).toContain('84.50'); // price
    expect(renderedValues).toContain('0.13'); // change
    expect(renderedValues).toContain('84.37'); // open
    expect(renderedValues).toContain('84.60'); // high
    expect(renderedValues).toContain('84.10'); // low
    expect(renderedValues).toContain('0.05'); // tick size

    expect(vi.mocked(PriceCell).mock.calls.length).toBeGreaterThanOrEqual(6);
  });
});
