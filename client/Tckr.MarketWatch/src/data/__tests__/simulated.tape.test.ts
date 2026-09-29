/**
 * The simulated tape under load: one 100,000-tick run at 20,000 events/s, checked
 * against the exchange it stands in for. Collected once and shared, because generating it
 * is the expensive part.
 *
 * - The kind mix is 40% TRADE / 30% BID / 30% ASK, ±2pp.
 * - Symbol selection is skewed like the exchange (measured 14.4% top-1, 59.1% top-10).
 * - Every price is a valid decimal on its symbol's tick grid, positive, and moves at most
 *   3 ticks per step.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { isDecimal } from '../../contracts/decimal.ts';
import type { Tick } from '../../contracts/messages.ts';
import { resetStore } from '../store.ts';
import { baseConfig, collectTicks, toScaledForTest } from './testSupport.ts';
import universeFile from '../../../public/symbols.json';

const TAPE_LENGTH = 100_000;

const GRID_BY_SYMBOL = new Map(
  (
    universeFile as {
      symbols: readonly { symbol: string; referencePrice: number; tickSize: number }[];
    }
  ).symbols.map((s) => [
    s.symbol,
    {
      reference: toScaledForTest(s.referencePrice.toString()),
      tick: toScaledForTest(s.tickSize.toString()),
    },
  ]),
);

let tape: Tick[] = [];

beforeAll(async () => {
  vi.useFakeTimers();
  resetStore();
  tape = await collectTicks(baseConfig({ eventsPerSecond: 20_000 }), TAPE_LENGTH);
  vi.useRealTimers();
}, 30_000);

describe('SimulatedSource tape over 100,000 ticks', () => {
  it('produces the full tape', () => {
    expect(tape).toHaveLength(TAPE_LENGTH);
  });

  it('mixes 40% TRADE / 30% BID / 30% ASK, ±2pp', () => {
    const counts = { TRADE: 0, BID: 0, ASK: 0 };
    for (const t of tape) counts[t.k] += 1;
    expect(Math.abs(counts.TRADE / TAPE_LENGTH - 0.4)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(counts.BID / TAPE_LENGTH - 0.3)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(counts.ASK / TAPE_LENGTH - 0.3)).toBeLessThanOrEqual(0.02);
  });

  it("reproduces the exchange's skew: top-1 12–18%, top-10 50–68%", () => {
    const counts = new Map<string, number>();
    for (const t of tape) counts.set(t.s, (counts.get(t.s) ?? 0) + 1);
    const sorted = [...counts.values()].sort((a, b) => b - a);
    const top1 = (sorted[0] ?? 0) / TAPE_LENGTH;
    const top10 = sorted.slice(0, 10).reduce((sum, n) => sum + n, 0) / TAPE_LENGTH;
    expect(top1).toBeGreaterThanOrEqual(0.12);
    expect(top1).toBeLessThanOrEqual(0.18);
    expect(top10).toBeGreaterThanOrEqual(0.5);
    expect(top10).toBeLessThanOrEqual(0.68);
  });

  it('emits only positive, on-grid decimal prices that step at most 3 ticks', () => {
    const last = new Map<string, bigint>();
    const offenders: string[] = [];
    for (const t of tape) {
      const grid = GRID_BY_SYMBOL.get(t.s);
      if (!grid || !isDecimal(t.p)) {
        offenders.push(`${t.s} ${t.p}`);
        continue;
      }
      const price = toScaledForTest(t.p);
      const previous = last.get(t.s);
      const steps = previous === undefined ? 0n : (price - previous) / grid.tick;
      if (price <= 0n || (price - grid.reference) % grid.tick !== 0n || steps > 3n || steps < -3n) {
        offenders.push(`${t.s} ${t.p}`);
      }
      last.set(t.s, price);
    }
    expect(offenders).toEqual([]);
  });
});
