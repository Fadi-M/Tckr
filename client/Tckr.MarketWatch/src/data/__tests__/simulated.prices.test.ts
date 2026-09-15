import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDecimal } from '../../contracts/decimal.ts';
import type { Tick } from '../../contracts/messages.ts';
import { resetStore } from '../store.ts';
import { baseConfig, collectTicks, toScaledForTest } from './testSupport.ts';
import universeFile from '../../../public/symbols.json';

interface RawSymbol {
  readonly symbol: string;
  readonly referencePrice: number;
  readonly tickSize: number;
}

const REFERENCE_BY_SYMBOL = new Map<string, { referenceScaled: bigint; tickScaled: bigint }>(
  (universeFile as { symbols: readonly RawSymbol[] }).symbols.map((s) => [
    s.symbol,
    {
      referenceScaled: toScaledForTest(s.referencePrice.toString()),
      tickScaled: toScaledForTest(s.tickSize.toString()),
    },
  ]),
);

describe('SimulatedSource price walk', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits only valid, on-grid decimal prices with steps of at most 3 ticks', async () => {
    const ticks = await collectTicks(baseConfig({ eventsPerSecond: 20000 }), 50000);
    expect(ticks).toHaveLength(50000);

    const lastScaledBySymbol = new Map<string, bigint>();

    for (const t of ticks) {
      expect(isDecimal(t.p)).toBe(true);
      const grid = REFERENCE_BY_SYMBOL.get(t.s);
      expect(grid).toBeDefined();
      if (!grid) continue;

      const scaledPrice = toScaledForTest(t.p);
      const offsetFromReference = scaledPrice - grid.referenceScaled;
      expect(offsetFromReference % grid.tickScaled).toBe(0n);

      const previous = lastScaledBySymbol.get(t.s);
      if (previous !== undefined) {
        const stepTicks = (scaledPrice - previous) / grid.tickScaled;
        const absSteps = stepTicks < 0n ? -stepTicks : stepTicks;
        expect(absSteps <= 3n).toBe(true);
      }
      lastScaledBySymbol.set(t.s, scaledPrice);
    }
  }, 30000);

  it('never emits a non-positive price', async () => {
    const ticks: Tick[] = await collectTicks(baseConfig({ eventsPerSecond: 5000 }), 10000);
    for (const t of ticks) {
      const scaled = toScaledForTest(t.p);
      expect(scaled > 0n).toBe(true);
    }
  }, 20000);
});
