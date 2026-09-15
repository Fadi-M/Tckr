import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStore } from '../store.ts';
import { baseConfig, collectTicks } from './testSupport.ts';

describe('SimulatedSource message kind mix', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is 40% TRADE / 30% BID / 30% ASK ±2pp over 100,000 ticks', async () => {
    const ticks = await collectTicks(baseConfig({ eventsPerSecond: 20000 }), 100000);
    expect(ticks).toHaveLength(100000);

    const counts = { TRADE: 0, BID: 0, ASK: 0 };
    for (const t of ticks) {
      counts[t.k] += 1;
    }
    const total = ticks.length;
    const tradeShare = counts.TRADE / total;
    const bidShare = counts.BID / total;
    const askShare = counts.ASK / total;

    // eslint-disable-next-line no-console
    console.info(
      `[simulated.mix] TRADE=${(tradeShare * 100).toFixed(2)}% BID=${(bidShare * 100).toFixed(2)}% ` +
        `ASK=${(askShare * 100).toFixed(2)}%`,
    );

    expect(tradeShare).toBeGreaterThanOrEqual(0.38);
    expect(tradeShare).toBeLessThanOrEqual(0.42);
    expect(bidShare).toBeGreaterThanOrEqual(0.28);
    expect(bidShare).toBeLessThanOrEqual(0.32);
    expect(askShare).toBeGreaterThanOrEqual(0.28);
    expect(askShare).toBeLessThanOrEqual(0.32);
  }, 30000);
});
