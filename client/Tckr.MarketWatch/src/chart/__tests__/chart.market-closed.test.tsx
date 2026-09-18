/**
 * `PriceChart`'s `marketOpen` prop — swaps the pulsing "Live — updates every ~30s" idle
 * cue for a static "Market closed" message once EGX has closed (see `StockDetail.tsx`,
 * the one caller, which computes this from `marketCalendar.getMarketStatus()`).
 */
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

describe('PriceChart marketOpen prop', () => {
  it('defaults to the open/live idle message when marketOpen is omitted', () => {
    render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} livePrice={{ t: 1000, p: toDecimal('85.00') }} />);
    expect(screen.getByText('Live — updates every ~30s')).toBeDefined();
  });

  it('shows the closed-market idle message when marketOpen is false', () => {
    render(
      <PriceChart
        symbol="COMI"
        tickSize={toDecimal('0.01')}
        livePrice={{ t: 1000, p: toDecimal('85.00') }}
        marketOpen={false}
      />,
    );
    expect(screen.getByText('Market closed — showing final session prices')).toBeDefined();
    expect(screen.queryByText('Live — updates every ~30s')).toBeNull();
  });

  it('updates the idle message on a live marketOpen transition (open -> closed) without remounting', () => {
    const { rerender } = render(
      <PriceChart symbol="COMI" tickSize={toDecimal('0.01')} livePrice={{ t: 1000, p: toDecimal('85.00') }} marketOpen={true} />,
    );
    expect(screen.getByText('Live — updates every ~30s')).toBeDefined();

    rerender(
      <PriceChart symbol="COMI" tickSize={toDecimal('0.01')} livePrice={{ t: 1000, p: toDecimal('85.00') }} marketOpen={false} />,
    );
    expect(screen.getByText('Market closed — showing final session prices')).toBeDefined();
  });

  it('updates the idle message on a live marketOpen transition (closed -> open)', () => {
    const { rerender } = render(
      <PriceChart symbol="COMI" tickSize={toDecimal('0.01')} livePrice={{ t: 1000, p: toDecimal('85.00') }} marketOpen={false} />,
    );
    expect(screen.getByText('Market closed — showing final session prices')).toBeDefined();

    rerender(
      <PriceChart symbol="COMI" tickSize={toDecimal('0.01')} livePrice={{ t: 1000, p: toDecimal('85.00') }} marketOpen={true} />,
    );
    expect(screen.getByText('Live — updates every ~30s')).toBeDefined();
  });
});
