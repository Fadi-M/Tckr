/**
 * The daily greeting's proportions, fitted to the screen. Everything is sized from one
 * number, the hero lockup's wordmark size, so the composition keeps its balance from a
 * phone to a 27" monitor instead of sitting small in the middle of a large one.
 */

/** Smallest and largest hero wordmark (px). 64 still fits "Tckr" on a 320px phone; 176
 * keeps the lockup a mark, not a banner, on very large screens. */
const HERO_MIN = 64;
const HERO_MAX = 176;

/** The hero wordmark size for a viewport: about 9% of its width or 13% of its height,
 * whichever is smaller (so a short, wide window doesn't overflow), clamped. */
export function heroSizeFor(viewportWidth: number, viewportHeight: number): number {
  const fitted = Math.min(viewportWidth * 0.09, viewportHeight * 0.13);
  return Math.round(Math.min(HERO_MAX, Math.max(HERO_MIN, fitted)));
}

export interface GreetingScale {
  /** "Good morning". */
  readonly salutationPx: number;
  /** "EGX is trading · …". */
  readonly marketPx: number;
  readonly dotPx: number;
  /** Between the lockup and the two lines, and between the lines. */
  readonly gapPx: number;
  readonly lineGapPx: number;
  /** The light behind the lockup: its diameter, capped at 78% of the viewport width. */
  readonly glowPx: number;
}

/** The rest of the greeting, in proportion to the hero wordmark. The floors keep the
 * text readable on phones, where the hero is at its minimum. */
export function greetingScale(heroPx: number): GreetingScale {
  return {
    salutationPx: Math.round(Math.max(28, heroPx * 0.36)),
    marketPx: Math.round(Math.max(12, heroPx * 0.13)),
    dotPx: Math.round(Math.max(6, heroPx * 0.06)),
    gapPx: Math.round(Math.max(20, heroPx * 0.3)),
    lineGapPx: Math.round(Math.max(10, heroPx * 0.12)),
    glowPx: Math.round(heroPx * 6.67),
  };
}
