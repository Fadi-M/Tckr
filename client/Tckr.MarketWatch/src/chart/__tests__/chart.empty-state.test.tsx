import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { toDecimal } from '../../contracts/decimal.ts';

vi.mock('uplot', async () => {
  const mod = await import('./uplotTestDouble.ts');
  return { default: mod.FakeUPlot };
});

import { resetUplotMock } from './uplotTestDouble.ts';
import { PriceChart } from '../PriceChart.tsx';

afterEach(cleanup);

beforeEach(() => {
  resetUplotMock();
});

describe('PriceChart empty state', () => {
  it('renders an explicit waiting placeholder before any data exists', () => {
    render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} />);
    expect(screen.queryByTestId('price-chart-empty-state')).not.toBeNull();
    expect(screen.getByText(/waiting for ticks/i)).toBeDefined();
  });

  it('removes the placeholder once a livePrice arrives (fed by the parent page, not an independent store read)', () => {
    const { rerender } = render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} />);
    expect(screen.queryByTestId('price-chart-empty-state')).not.toBeNull();

    rerender(
      <PriceChart symbol="COMI" tickSize={toDecimal('0.01')} livePrice={{ t: Date.now(), p: toDecimal('85.42') }} />,
    );

    expect(screen.queryByTestId('price-chart-empty-state')).toBeNull();
  });

  it('removes the placeholder when history alone is non-empty, even with no livePrice yet', () => {
    render(
      <PriceChart
        symbol="COMI"
        tickSize={toDecimal('0.01')}
        history={[{ t: 1000, p: toDecimal('85.10') }]}
      />,
    );
    expect(screen.queryByTestId('price-chart-empty-state')).toBeNull();
  });
});
