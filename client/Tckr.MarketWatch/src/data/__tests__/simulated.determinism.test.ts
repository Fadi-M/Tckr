import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tick } from '../../contracts/messages.ts';
import { resetStore } from '../store.ts';
import { baseConfig, collectTicks } from './testSupport.ts';

function shapeOf(t: Tick): { s: string; p: string; k: string; q: number } {
  return { s: t.s, p: t.p, k: t.k, q: t.q };
}

describe('SimulatedSource determinism', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('produces an identical first 10,000 ticks for the same seed', async () => {
    const a = await collectTicks(baseConfig({ seed: 20260912 }), 10000);
    const b = await collectTicks(baseConfig({ seed: 20260912 }), 10000);
    expect(a).toHaveLength(10000);
    expect(b).toHaveLength(10000);
    expect(a.map(shapeOf)).toEqual(b.map(shapeOf));
  }, 20000);

  it('produces a different tape for a different seed', async () => {
    const a = await collectTicks(baseConfig({ seed: 20260912 }), 2000);
    const b = await collectTicks(baseConfig({ seed: 1 }), 2000);
    expect(a.map(shapeOf)).not.toEqual(b.map(shapeOf));
  }, 20000);
});
