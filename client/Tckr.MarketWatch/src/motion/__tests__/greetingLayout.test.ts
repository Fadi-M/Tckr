/**
 * The greeting is fitted to the screen: bigger on a large monitor, never below a readable
 * floor on a phone, never overflowing a short window, and in proportion throughout.
 */
import { describe, expect, it } from 'vitest';
import { greetingScale, heroSizeFor } from '../greetingLayout.ts';

describe('heroSizeFor', () => {
  it('grows with the screen, from laptop to large monitor', () => {
    const laptop = heroSizeFor(1280, 720);
    const desktop = heroSizeFor(1920, 1080);
    const large = heroSizeFor(2560, 1440);
    expect(laptop).toBeLessThan(desktop);
    expect(desktop).toBeLessThan(large);
    expect(desktop).toBe(140);
  });

  it('keeps a readable floor on phones and a cap on very large screens', () => {
    expect(heroSizeFor(320, 568)).toBe(64);
    expect(heroSizeFor(390, 844)).toBe(64);
    expect(heroSizeFor(5120, 2880)).toBe(176);
  });

  it('fits by the smaller dimension, so a short, wide window does not overflow', () => {
    expect(heroSizeFor(2560, 600)).toBe(Math.round(600 * 0.13));
  });
});

describe('greetingScale', () => {
  it('scales the text, dot and spacing with the hero', () => {
    const small = greetingScale(96);
    const big = greetingScale(176);
    for (const key of ['salutationPx', 'marketPx', 'dotPx', 'gapPx', 'lineGapPx'] as const) {
      expect(big[key]).toBeGreaterThan(small[key]);
    }
  });

  it('keeps the salutation the dominant line and the market line readable', () => {
    for (const hero of [64, 96, 140, 176]) {
      const scale = greetingScale(hero);
      expect(scale.salutationPx).toBeGreaterThanOrEqual(28);
      expect(scale.marketPx).toBeGreaterThanOrEqual(12);
      expect(scale.salutationPx).toBeGreaterThan(scale.marketPx * 2);
    }
  });
});
