import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { resetStore } from '../../data/store.ts';
import { cibDefinition, comiDefinition, createFakeSource, universeFixture } from './testSupport.ts';

// Exposes the fake uPlot's constructor calls/instances to the test body, so a symbol
// switch can be shown to destroy the old chart instance and construct a fresh one —
// "the chart is remounted/reset with no COMI point" from the brief. `vi.hoisted` is
// required because `vi.mock` factories are hoisted above ordinary imports/consts.
const { fakeUplotConstructorSpy, fakeUplotInstances } = vi.hoisted(() => {
  return {
    fakeUplotConstructorSpy: vi.fn(),
    fakeUplotInstances: [] as Array<{ destroy: ReturnType<typeof vi.fn> }>,
  };
});

vi.mock('uplot', () => {
  class FakeUPlot {
    setData = vi.fn();
    destroy = vi.fn();
    setSize = vi.fn();
    redraw = vi.fn();
    root = document.createElement('div');
    cursor = { idx: null };
    data: [number[], number[]] = [[], []];
    constructor(...args: unknown[]) {
      fakeUplotConstructorSpy(...args);
      fakeUplotInstances.push(this);
    }
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

import { getSharedSource, resetSharedSource } from '../../data/config.ts';
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
  resetSharedSource();
});

describe('StockDetail symbol switch', () => {
  it('unsubscribes the old symbol before subscribing the new one, and resets the chart', async () => {
    const { source, callOrder } = createTwoSymbolFakeSource();
    vi.mocked(getSharedSource).mockReturnValue(source);

    const { rerender } = render(
      <MemoryRouter>
        <StockDetail symbol="COMI" />
      </MemoryRouter>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fakeUplotConstructorSpy).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['subscribe(COMI)']);
    const comiChart = fakeUplotInstances[0];
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
    expect(fakeUplotConstructorSpy).toHaveBeenCalledTimes(2);
  });
});
