/**
 * The chart's price-axis tag layout (critique 2026-09-26): the Open label lives as a
 * tag on the price axis beside the last-price tag, never overlapping it or the axis
 * labels, and never inside the plot where the line could run through it.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('uplot', async () => {
  const mod = await import('./uplotTestDouble.ts');
  return { default: mod.FakeUPlot };
});

import { isUnderAxisTag, placeAxisTags } from '../PriceChart.tsx';

describe('placeAxisTags', () => {
  it('leaves both tags on their own values when they are apart', () => {
    expect(placeAxisTags(100, 200)).toEqual({ last: 100, ref: 200 });
  });

  it('steps the reference tag clear of the last-price tag, on the side it lies', () => {
    expect(placeAxisTags(100, 105)).toEqual({ last: 100, ref: 118 });
    expect(placeAxisTags(100, 95)).toEqual({ last: 100, ref: 82 });
  });

  it('handles a missing tag', () => {
    expect(placeAxisTags(null, 120)).toEqual({ last: null, ref: 120 });
    expect(placeAxisTags(80, null)).toEqual({ last: 80, ref: null });
  });
});

describe('isUnderAxisTag', () => {
  it('blanks an axis label that a tag would cover, and only that', () => {
    expect(isUnderAxisTag(110, [100, null])).toBe(true);
    expect(isUnderAxisTag(130, [100, null])).toBe(false);
    expect(isUnderAxisTag(210, [100, 205])).toBe(true);
  });
});
