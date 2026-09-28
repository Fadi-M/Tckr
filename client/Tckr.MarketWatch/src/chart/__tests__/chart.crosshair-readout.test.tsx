/**
 * `chart.crosshair-readout.test.tsx` — hovering the chart names what the crosshair is on:
 * a readout chip with the hovered sample's Cairo time and its price at the instrument's
 * tick-size precision, hidden again when the cursor leaves the plot (`idx` null). Driven
 * through uPlot's `setCursor` hook, which the test double lets us call directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { toDecimal } from '../../contracts/decimal.ts';
import { formatCairoClock } from '../../data/marketCalendar.ts';

vi.mock('uplot', async () => {
  const mod = await import('./uplotTestDouble.ts');
  return { default: mod.FakeUPlot };
});

import { constructorSpy, instances, resetUplotMock } from './uplotTestDouble.ts';
import { PriceChart } from '../PriceChart.tsx';

type SetCursorHook = (u: unknown) => void;

function setCursorHook(): SetCursorHook {
  const options = constructorSpy.mock.calls[0]?.[0] as { hooks?: { setCursor?: SetCursorHook[] } };
  const hook = options.hooks?.setCursor?.[0];
  if (!hook) {
    throw new Error('PriceChart registered no setCursor hook');
  }
  return hook;
}

afterEach(cleanup);

beforeEach(() => {
  resetUplotMock();
});

describe('PriceChart crosshair readout', () => {
  it('shows the hovered time and price, and hides when the cursor leaves', () => {
    const t = Date.UTC(2026, 8, 24, 9, 31, 5);
    render(
      <PriceChart
        symbol="COMI"
        tickSize={toDecimal('0.05')}
        history={[{ t, p: toDecimal('85.35') }]}
      />,
    );
    const plot = instances[0]!;
    const readout = plot.over.querySelector<HTMLElement>('[data-testid="price-chart-readout"]')!;
    expect(readout.hidden).toBe(true);

    plot.data = [[t], [85.35]];
    plot.cursor.idx = 0;
    setCursorHook()(plot);
    expect(readout.hidden).toBe(false);
    expect(readout.textContent).toBe(`${formatCairoClock(t)}85.35`);

    plot.cursor.idx = null;
    setCursorHook()(plot);
    expect(readout.hidden).toBe(true);
  });
});
