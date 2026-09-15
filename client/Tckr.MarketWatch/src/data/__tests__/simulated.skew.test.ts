import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStore } from '../store.ts';
import { baseConfig, collectTicks } from './testSupport.ts';

describe('SimulatedSource selection skew', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reproduces the exchange’s skew over 100,000 ticks: top-1 12-18%, top-10 50-68%', async () => {
    const ticks = await collectTicks(baseConfig({ eventsPerSecond: 20000 }), 100000);
    expect(ticks).toHaveLength(100000);

    const counts = new Map<string, number>();
    for (const t of ticks) {
      counts.set(t.s, (counts.get(t.s) ?? 0) + 1);
    }
    const sorted = [...counts.values()].sort((a, b) => b - a);
    const total = ticks.length;
    const top1Share = (sorted[0] ?? 0) / total;
    const top10Share = sorted.slice(0, 10).reduce((sum, n) => sum + n, 0) / total;

    // eslint-disable-next-line no-console
    console.info(
      `[simulated.skew] top1=${(top1Share * 100).toFixed(2)}% top10=${(top10Share * 100).toFixed(2)}% ` +
        '(exchange measured: 14.4% / 59.1%)',
    );

    expect(top1Share).toBeGreaterThanOrEqual(0.12);
    expect(top1Share).toBeLessThanOrEqual(0.18);
    expect(top10Share).toBeGreaterThanOrEqual(0.5);
    expect(top10Share).toBeLessThanOrEqual(0.68);
  }, 30000);
});
