import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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

import { getSharedSource, resetSharedSource } from '../../data/config.ts';
import { StockDetail } from '../StockDetail.tsx';

afterEach(cleanup);

beforeEach(() => {
  resetStore();
  resetSharedSource();
});

describe('StockDetail subscribe/unsubscribe lifecycle', () => {
  it('subscribes once on mount and unsubscribes once on unmount (no StrictMode)', () => {
    const { source, subscribe, unsubscribe } = createFakeSource();
    vi.mocked(getSharedSource).mockReturnValue(source);

    const { unmount } = render(
      <MemoryRouter>
        <StockDetail symbol="COMI" />
      </MemoryRouter>,
    );

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledWith(['COMI']);
    expect(unsubscribe).not.toHaveBeenCalled();

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledWith(['COMI']);
    // eslint-disable-next-line no-console
    console.info(
      '[StockDetail.subscribe-lifecycle] plain mount call log:',
      JSON.stringify({ subscribe: subscribe.mock.calls, unsubscribe: unsubscribe.mock.calls }),
    );
  });

  it('nets exactly one active subscription under StrictMode double-invocation', () => {
    const { source, subscribe, unsubscribe } = createFakeSource();
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(
      <StrictMode>
        <MemoryRouter>
          <StockDetail symbol="COMI" />
        </MemoryRouter>
      </StrictMode>,
    );

    expect(screen.getByTestId('stock-detail-loading')).toBeTruthy();

    const net = subscribe.mock.calls.length - unsubscribe.mock.calls.length;
    expect(net).toBe(1);
    // eslint-disable-next-line no-console
    console.info(
      '[StockDetail.subscribe-lifecycle] StrictMode call log:',
      JSON.stringify({ subscribe: subscribe.mock.calls, unsubscribe: unsubscribe.mock.calls }),
      'net =',
      net,
    );
  });
});
