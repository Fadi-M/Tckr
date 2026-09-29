/**
 * Switching symbols in place (↑/↓, next/previous) must never show one instrument's data
 * under another: the old symbol is unsubscribed before the new one is subscribed, the
 * chart is rebuilt with no old point, and no render under the new symbol carries the old
 * one's figures (which would also flash ▲/▼ as if a tick had landed).
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toDecimal } from '../../contracts/decimal.ts';
import { resetStore } from '../../data/store.ts';
import {
  constructorSpy,
  instances,
  resetUplotMock,
} from '../../chart/__tests__/uplotTestDouble.ts';
import {
  cibDefinition,
  comiDefinition,
  createFakeSource,
  renderDetail,
  snapshotFixture,
  universeFixture,
} from './testSupport.tsx';

vi.mock('uplot', async () => ({
  default: (await import('../../chart/__tests__/uplotTestDouble.ts')).FakeUPlot,
}));
vi.mock('../../data/config.ts');
vi.mock('../../components/PriceCell.tsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/PriceCell.tsx')>();
  return { ...actual, PriceCell: vi.fn(actual.PriceCell) };
});

import { PriceCell } from '../../components/PriceCell.tsx';
import { StockDetail } from '../StockDetail.tsx';

function createTwoSymbolFakeSource() {
  return createFakeSource({
    universe: universeFixture({ symbols: [comiDefinition(), cibDefinition()] }),
    trackCallOrder: true,
  });
}

afterEach(cleanup);

beforeEach(() => {
  resetStore();
  resetUplotMock();
});

describe('StockDetail symbol switch', () => {
  it('unsubscribes the old symbol before subscribing the new one, and resets the chart', async () => {
    const { source, callOrder } = createTwoSymbolFakeSource();
    const { rerender } = await renderDetail(<StockDetail symbol="COMI" />, source);

    expect(constructorSpy).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['subscribe(COMI)']);
    const comiChart = instances[0];
    expect(comiChart).toBeDefined();

    await act(async () => {
      rerender(
        <MemoryRouter>
          <StockDetail symbol="CIB" />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // Order asserted via one shared spy log: unsubscribe(COMI) strictly before
    // subscribe(CIB).
    expect(callOrder).toEqual(['subscribe(COMI)', 'unsubscribe(COMI)', 'subscribe(CIB)']);

    // The chart is remounted for the new symbol: the old uPlot instance is destroyed
    // and a fresh one constructed — no COMI point survives into CIB's chart.
    expect(comiChart?.destroy).toHaveBeenCalledTimes(1);
    expect(constructorSpy).toHaveBeenCalledTimes(2);
  });

  it("never renders the old symbol's figures under the new symbol", async () => {
    // Distinct prices per symbol, so a stale carry-over would register as a change.
    const { source } = createFakeSource({
      universe: universeFixture({ symbols: [comiDefinition(), cibDefinition()] }),
      snapshotImpl: (symbol) =>
        Promise.resolve(
          snapshotFixture(symbol === 'CIB' ? { symbol, price: toDecimal('70.25') } : { symbol }),
        ),
    });
    const { rerender, container } = await renderDetail(<StockDetail symbol="COMI" />, source);
    const comiPrice = screen.getByTestId('stock-detail-price').textContent;
    vi.mocked(PriceCell).mockClear();

    await act(async () => {
      rerender(
        <MemoryRouter>
          <StockDetail symbol="CIB" />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // Not one render under CIB may carry COMI's price: that stale render is what made
    // the cells "move" to CIB's figures and flash ▲/▼ when they stayed mounted.
    const renderedAfterSwitch = vi
      .mocked(PriceCell)
      .mock.calls.map((call) => String(call[0].value));
    expect(renderedAfterSwitch).not.toContain(comiPrice);

    // CIB's price differs from COMI's, but the switch is not a tick: had COMI's figures
    // stayed on screen under CIB for a commit, every PriceCell would now be mid-flash.
    expect(screen.getByTestId('stock-detail-symbol').textContent).toBe('CIB');
    expect(screen.getByTestId('stock-detail-price').textContent).toBe('70.25');
    expect(container.querySelector('[class*="animate-price-flash"]')).toBeNull();
  });
});
