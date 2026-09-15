import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { toDecimal } from '../../contracts/decimal.ts';
import { applyTick, resetStore } from '../../data/store.ts';
import { tick } from './chartTestSupport.ts';

vi.mock('uplot', async () => {
  const mod = await import('./uplotTestDouble.ts');
  return { default: mod.FakeUPlot };
});

import { constructorSpy, instances, resetUplotMock } from './uplotTestDouble.ts';
import { PriceChart } from '../PriceChart.tsx';

// Builds "85.00" + i cents as a DecimalString via pure integer arithmetic — this file
// lives under src/chart/**, so it must never use the banned float-to-string built-in
// either (grep DoD check; see chart.formatting.test.ts).
function priceAt(i: number) {
  const cents = 8500 + i;
  const intPart = Math.floor(cents / 100);
  const frac = (cents % 100).toString().padStart(2, '0');
  return toDecimal(`${intPart}.${frac}`);
}

afterEach(cleanup);

beforeEach(() => {
  resetStore();
  resetUplotMock();
});

describe('PriceChart single uPlot instance', () => {
  it('constructs exactly one uPlot instance for 1,000 subsequent data updates', () => {
    render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} />);
    expect(constructorSpy).toHaveBeenCalledTimes(1);

    act(() => {
      for (let i = 0; i < 1000; i += 1) {
        applyTick(tick({ id: `evt-${i}`, p: priceAt(i) }));
      }
    });

    expect(constructorSpy).toHaveBeenCalledTimes(1);
  });

  it('recreates the instance only when the symbol prop changes, and destroys the old one', () => {
    const { rerender } = render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} />);
    expect(constructorSpy).toHaveBeenCalledTimes(1);
    const first = instances[0];
    expect(first).toBeDefined();

    // Non-symbol prop changes must not recreate the instance.
    rerender(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} height={480} />);
    expect(constructorSpy).toHaveBeenCalledTimes(1);
    expect(first?.destroy).not.toHaveBeenCalled();

    // A symbol change recreates it: old instance destroyed, a new one constructed.
    rerender(<PriceChart symbol="CIB" tickSize={toDecimal('0.05')} />);
    expect(constructorSpy).toHaveBeenCalledTimes(2);
    expect(first?.destroy).toHaveBeenCalledTimes(1);
    const second = instances[1];
    expect(second).toBeDefined();
    expect(second?.destroy).not.toHaveBeenCalled();
  });

  it('destroys the instance on unmount', () => {
    const { unmount } = render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} />);
    const only = instances[0];
    expect(only).toBeDefined();
    unmount();
    expect(only?.destroy).toHaveBeenCalledTimes(1);
  });
});
