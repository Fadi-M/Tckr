/**
 * Page context for assistive tech: the tab title names the open instrument (and is
 * restored when the detail closes), and the price is announced only after the user opts
 * in with "Announce price", which is remembered on this device.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { resetStore } from '../../data/store.ts';
import { toDecimal } from '../../contracts/decimal.ts';
import {
  cibDefinition,
  comiDefinition,
  createFakeSource,
  snapshotFixture,
  universeFixture,
} from './testSupport.ts';

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

function liveRegion(): HTMLElement {
  const region = document.querySelector<HTMLElement>('[aria-live="polite"]');
  if (!region) throw new Error('no polite live region');
  return region;
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

describe('StockDetail price announcements', () => {
  it('announces nothing until the user opts in', async () => {
    await renderDetail('COMI');
    const toggle = screen.getByRole('button', { name: 'Announce price' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(liveRegion().textContent).toBe('');
  });

  it('announces the price and move once enabled, and remembers the choice', async () => {
    await renderDetail('COMI');
    fireEvent.click(screen.getByRole('button', { name: 'Announce price' }));

    expect(
      screen.getByRole('button', { name: 'Announce price' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(liveRegion().textContent).toMatch(/^COMI 84\.50, up \d+\.\d{2} percent$/);
    expect(localStorage.getItem('tckr-announce-price')).toBe('on');
  });

  it('reads a real but sub-0.01% move as "less than 0.01 percent", never "0.00"', async () => {
    localStorage.setItem('tckr-announce-price', 'on');
    const { source } = createFakeSource({
      snapshotImpl: (symbol) =>
        Promise.resolve(
          snapshotFixture({
            symbol,
            price: toDecimal('1000.01'),
            previousClose: toDecimal('1000.00'),
          }),
        ),
    });
    await renderDetail('COMI', source);
    expect(liveRegion().textContent).toBe('COMI 1000.01, up less than 0.01 percent');
  });

  it('starts enabled when the user opted in on an earlier visit', async () => {
    localStorage.setItem('tckr-announce-price', 'on');
    await renderDetail('COMI');
    expect(liveRegion().textContent).toContain('COMI 84.50');
  });
});
