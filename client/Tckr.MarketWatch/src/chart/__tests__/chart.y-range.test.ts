import { describe, expect, it, vi } from 'vitest';

vi.mock('uplot', async () => {
  const mod = await import('./uplotTestDouble.ts');
  return { default: mod.FakeUPlot };
});

import { chartYRange } from '../chartScale.ts';

describe('chartYRange', () => {
  it('keeps the reference price inside the range even when every value sits above it', () => {
    const [lo, hi] = chartYRange(85.0, 85.85, 84.0, 0.05);
    expect(lo).toBeLessThan(84.0);
    expect(hi).toBeGreaterThan(85.85);
  });

  it('widens a quiet session to at least 1% of the price, centred on its midpoint', () => {
    // A 0.10 wiggle on an 85 stock must not be stretched edge to edge.
    const [lo, hi] = chartYRange(85.0, 85.1, null, 0.05);
    const span = hi - lo;
    expect(span).toBeGreaterThanOrEqual(0.85);
    expect((lo + hi) / 2).toBeCloseTo(85.05, 6);
  });

  it('pads a wide range by 10% on each side so extremes never touch the frame', () => {
    const [lo, hi] = chartYRange(80, 90, null, 0.05);
    expect(lo).toBeCloseTo(79, 6);
    expect(hi).toBeCloseTo(91, 6);
  });

  it('never returns a degenerate range for flat or missing data', () => {
    const [flatLo, flatHi] = chartYRange(18.42, 18.42, null, 0.01);
    expect(flatHi - flatLo).toBeGreaterThan(0);
    expect(flatLo).toBeGreaterThan(18);

    expect(chartYRange(null, null, null, 0.01)).toEqual([0, 1]);
    const [refLo, refHi] = chartYRange(null, null, 50, 0.01);
    expect(refLo).toBeLessThan(50);
    expect(refHi).toBeGreaterThan(50);
  });
});
