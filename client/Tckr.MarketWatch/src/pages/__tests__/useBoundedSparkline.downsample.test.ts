/**
 * `downsampleSeries` — critique 2026-09-27: sampling single ticks out of a noisy session
 * kept the noise, so sparklines read as texture rather than trend. Each inner point is
 * now the mean of its slice of the session; the first and last points stay exact.
 */
import { describe, expect, it } from 'vitest';
import { downsampleSeries } from '../useBoundedSparkline.ts';

describe('downsampleSeries', () => {
  it('returns a short series unchanged', () => {
    expect(downsampleSeries([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });

  it('keeps the first and last points exact and returns maxPoints points', () => {
    const values = Array.from({ length: 1001 }, (_, i) => i);
    const out = downsampleSeries(values, 20);
    expect(out).toHaveLength(20);
    expect(out[0]).toBe(0);
    expect(out[19]).toBe(1000);
  });

  it('averages each slice, so alternating noise flattens to its trend', () => {
    // A zig-zag of ±5 around a flat 100: every sampled tick is 95 or 105, but the
    // session's shape is flat.
    const values = Array.from({ length: 400 }, (_, i) => (i % 2 === 0 ? 95 : 105));
    const inner = downsampleSeries(values, 20).slice(1, -1);
    for (const point of inner) {
      expect(Math.abs(point - 100)).toBeLessThanOrEqual(1);
    }
  });
});
