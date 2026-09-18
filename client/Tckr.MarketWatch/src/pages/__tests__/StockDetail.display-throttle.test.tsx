/**
 * `StockDetail.display-throttle.test.tsx` — "Tckr First Run" design pass follow-up.
 * `StockDetail` reads `source.on.tick` directly, uncoalesced (module doc in
 * `../StockDetail.tsx`) — a hot symbol can burst far more ticks/sec than a human can
 * read as discrete price changes. This asserts the fix: once the page is `ready`, a
 * burst of ticks inside one `DISPLAY_REFRESH_INTERVAL_MS` window paints at most twice
 * (the leading tick, then one trailing catch-up), and the value shown after the window
 * is the *latest* tick, never one from the middle of the burst.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toDecimal } from '../../contracts/decimal.ts';
import type { IsoUtc, Tick } from '../../contracts/messages.ts';
import { resetStore } from '../../data/store.ts';
import { DISPLAY_REFRESH_INTERVAL_MS } from '../../display/throttle.ts';
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

vi.mock('../../components/PriceCell.tsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/PriceCell.tsx')>();
  return {
    ...actual,
    PriceCell: vi.fn((props: Parameters<typeof actual.PriceCell>[0]) => <actual.PriceCell {...props} />),
  };
});

import { getSharedSource, resetSharedSource } from '../../data/config.ts';
import { PriceCell } from '../../components/PriceCell.tsx';
import { StockDetail } from '../StockDetail.tsx';

/** A burst tick, indexed by `seq` so a whole burst gets distinct ids/timestamps —
 * distinct from the shared `tickFixture` (which overrides a full `Tick` object) since
 * every call site here always varies both `price` and `seq` together. */
function burstTickFixture(price: string, seq: number): Tick {
  return {
    v: 1,
    type: 'tick',
    s: 'COMI',
    p: toDecimal(price),
    q: 10,
    k: 'TRADE',
    t: `2026-09-12T10:30:05.${String(seq).padStart(3, '0')}Z` as IsoUtc,
    id: `evt-00000000000000${seq}`,
    st: 'LIVE',
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  resetStore();
  resetSharedSource();
});

describe('StockDetail display refresh throttling', () => {
  it('paints a burst of live ticks at most twice per window, ending on the latest tick', async () => {
    vi.useFakeTimers();
    const { source, emitTick } = createFakeSource();
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(
      <MemoryRouter>
        <StockDetail symbol="COMI" />
      </MemoryRouter>,
    );

    // Reach `ready` (snapshot resolves synchronously in this fixture).
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId('stock-detail-price').textContent).toContain('84.50');

    vi.mocked(PriceCell).mockClear();

    // A burst well within one throttle window — simulating a hot symbol's tape.
    const burstSize = 40;
    act(() => {
      for (let i = 0; i < burstSize; i += 1) {
        emitTick(burstTickFixture((85 + i * 0.01).toFixed(2), i));
      }
    });

    // Leading tick painted immediately; the other 39 are suppressed until the window
    // elapses — never one render per tick.
    const pricesAfterLeading = vi
      .mocked(PriceCell)
      .mock.calls.map((call) => String(call[0]?.value ?? ''))
      .filter((v) => v.startsWith('85.'));
    expect(pricesAfterLeading.length).toBeLessThan(burstSize);
    expect(screen.getByTestId('stock-detail-price').textContent).toContain('85.00');

    // Flush the trailing edge: exactly one more paint, showing the *last* tick of the
    // burst (85 + 39*0.01 = 85.39), never a mid-burst value.
    await act(async () => {
      vi.advanceTimersByTime(DISPLAY_REFRESH_INTERVAL_MS);
    });
    expect(screen.getByTestId('stock-detail-price').textContent).toContain('85.39');

    // Regression for the volume-accounting bug: even though only the leading and
    // trailing ticks of the 40-tick burst ever reach `mergeTickIntoQuote` (everything
    // in between is collapsed by the throttle), every tick's `q` (10 each) must still
    // be counted — the display throttle must never be allowed to drop traded quantity.
    const expectedVolume = 216637 + burstSize * 10;
    expect(screen.getByTestId('stock-detail-footer').textContent).toContain(
      new Intl.NumberFormat('en-US').format(expectedVolume),
    );
  });
});
