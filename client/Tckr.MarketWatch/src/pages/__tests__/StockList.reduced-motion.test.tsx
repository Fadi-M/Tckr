/**
 * `StockList.reduced-motion.test.tsx` — "Tckr First Run" design-review fix. The ticker
 * tape marquee (`TickerTape`) is decorative and previously scrolled unconditionally
 * (`animation: tckr-tape-scroll 32s linear infinite` with no `prefers-reduced-motion`
 * guard anywhere in the file) — a WCAG 2.2.2 (Pause/Stop/Hide) failure and a real
 * vestibular-accessibility problem. `StockList.tsx` now gates the scrolling animation
 * behind `@media (prefers-reduced-motion: no-preference)`, forces `animation: none`
 * under `(prefers-reduced-motion: reduce)`, and adds a hover-pause affordance scoped to
 * hover-capable pointers.
 *
 * This test does not (and cannot, under jsdom, which does not evaluate `@media`) assert
 * that the animation is actually suppressed at runtime — it asserts the stylesheet
 * StockList renders (a plain `<style>` tag whose text content is the
 * `STOCK_LIST_STYLES` module constant) contains the required rules, which is what the
 * review asked for and is a stable, load-bearing regression guard against someone
 * later deleting the media query.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { resetStore } from '../../data/store.ts';
import { loadUniverseFixture, makeFakeSource } from './testSupport.ts';

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({ getSharedSource: mockGetSharedSource }));

import { StockList } from '../StockList.tsx';

describe('StockList ticker-tape reduced-motion', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('gates the scrolling animation behind prefers-reduced-motion and offers a hover pause', async () => {
    const universeSymbols = loadUniverseFixture();
    mockGetSharedSource.mockReturnValue(makeFakeSource(universeSymbols).source);

    const { container } = render(
      <MemoryRouter>
        <StockList />
      </MemoryRouter>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const styleTag = container.querySelector('style');
    expect(styleTag).not.toBeNull();
    const css = styleTag?.textContent ?? '';

    // The scrolling animation only runs when the user has no reduced-motion preference.
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*no-preference\)/);
    expect(css).toContain('tckr-tape-scroll');

    // Under a reduced-motion preference the track is explicitly de-animated.
    const reduceBlockMatch = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([^}]*\{[^}]*\})/);
    expect(reduceBlockMatch).not.toBeNull();
    expect(reduceBlockMatch?.[1]).toContain('animation: none');

    // A hover-capable pointer can pause the marquee to read one ticker.
    expect(css).toMatch(/@media\s*\(hover:\s*hover\)/);
    expect(css).toContain('.tckr-tape:hover .tckr-tape__track');
    expect(css).toContain('animation-play-state: paused');
  });
});
