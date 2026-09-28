/**
 * Page context for assistive tech: the tab title names the open instrument, is restored
 * when the detail closes, and never pairs a new ticker with the previous instrument's name.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { resetStore } from '../../data/store.ts';
import { cibDefinition, comiDefinition, createFakeSource, universeFixture } from './testSupport.ts';

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

async function renderDetail(symbol: string, source = createFakeSource().source) {
  vi.mocked(getSharedSource).mockReturnValue(source);
  const view = render(
    <MemoryRouter initialEntries={[`/EGX/symbols/${symbol}`]}>
      <StockDetail symbol={symbol} />
    </MemoryRouter>,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return view;
}

afterEach(cleanup);

beforeEach(() => {
  resetStore();
  resetSharedSource();
  localStorage.clear();
  document.title = 'Tckr MarketWatch';
});

describe('StockDetail document title', () => {
  it('names the instrument, then restores the app title on close', async () => {
    const { unmount } = await renderDetail('COMI');
    expect(document.title).toBe('COMI · Commercial International Holding · Tckr MarketWatch');

    unmount();
    expect(document.title).toBe('Tckr MarketWatch');
  });

  it("never pairs the new ticker with the previous instrument's name on a switch", async () => {
    const titles: string[] = [];
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'title')!;
    vi.spyOn(document, 'title', 'set').mockImplementation(function (this: Document, value) {
      titles.push(value);
      descriptor.set!.call(this, value);
    });
    const { source } = createFakeSource({
      universe: universeFixture({ symbols: [comiDefinition(), cibDefinition()] }),
    });
    vi.mocked(getSharedSource).mockReturnValue(source);
    const { rerender } = render(
      <MemoryRouter>
        <StockDetail symbol="COMI" />
      </MemoryRouter>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    rerender(
      <MemoryRouter>
        <StockDetail symbol="CIB" />
      </MemoryRouter>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(titles).not.toContain('CIB · Commercial International Holding · Tckr MarketWatch');
    expect(document.title).toBe('CIB · Commercial International Bank · Tckr MarketWatch');
  });

  it('says the symbol is unknown on the not-found view', async () => {
    const { source } = createFakeSource({
      snapshotImpl: (symbol) => Promise.reject(new Error(`Unknown symbol: ${symbol}`)),
    });
    await renderDetail('NOPE', source);
    expect(document.title).toBe('Unknown symbol NOPE · Tckr MarketWatch');
  });
});
