import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { toDecimal } from '../../contracts/decimal.ts';
import { applyTick, resetStore } from '../../data/store.ts';
import { tick } from './chartTestSupport.ts';

vi.mock('uplot', async () => {
  const mod = await import('./uplotTestDouble.ts');
  return { default: mod.FakeUPlot };
});

import { resetUplotMock } from './uplotTestDouble.ts';
import { PriceChart } from '../PriceChart.tsx';

afterEach(cleanup);

beforeEach(() => {
  resetStore();
  resetUplotMock();
});

describe('PriceChart empty state', () => {
  it('renders an explicit waiting placeholder before any data exists', () => {
    render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} />);
    expect(screen.queryByTestId('price-chart-empty-state')).not.toBeNull();
    expect(screen.getByText(/waiting for ticks/i)).toBeDefined();
  });

  it('removes the placeholder once a point has arrived', () => {
    render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} />);
    expect(screen.queryByTestId('price-chart-empty-state')).not.toBeNull();

    act(() => {
      applyTick(tick());
    });

    expect(screen.queryByTestId('price-chart-empty-state')).toBeNull();
  });
});
