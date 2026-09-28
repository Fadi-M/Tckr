/**
 * The header logo's hover (`useLogoHover`): under a mouse the candle opens and trades,
 * with its body anchored at the open and its upper wick always meeting the crossbar. It
 * turns the down colour exactly while the close is below rest; "ckr" never moves. Leaving
 * (or unmounting) returns the exact, green, resting mark. Touch, reduced
 * motion and the greeting's hidden logo leave it at rest.
 */
import { act, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { TckrLogo } from '../../components/TckrLogo.tsx';
import { useLogoHover } from '../useLogoHover.ts';
import { loadMotion } from '../motion.ts';
import { finishMotion, primeMotion, resetMotion } from './motionTestSupport.ts';

function HeaderLogo() {
  const ref = useRef<HTMLAnchorElement | null>(null);
  useLogoHover(ref);
  return (
    <a ref={ref} href="/" aria-label="Tckr">
      <TckrLogo size={24} />
    </a>
  );
}

function stubMedia({ fine, reduce }: { fine: boolean; reduce: boolean }): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches:
      (fine && query.includes('pointer: fine')) ||
      (reduce && query.includes('prefers-reduced-motion')),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function geometry(container: Element) {
  const attr = (part: string, name: string) =>
    Number(container.querySelector(`[data-candle="${part}"]`)!.getAttribute(name));
  return {
    barY: attr('bar', 'y'),
    wickTop: attr('wick-high', 'y'),
    wickBottom: attr('wick-high', 'y') + attr('wick-high', 'height'),
    bodyTop: attr('body', 'y'),
    bodyBottom: attr('body', 'y') + attr('body', 'height'),
    lowHeight: attr('wick-low', 'height'),
  };
}

const REST = { barY: 4, wickTop: 15, wickBottom: 25, bodyTop: 25, bodyBottom: 59, lowHeight: 11 };

/** Seeks every running animation to `progress`, as a frame at that point would draw. */
async function seekAll(progress: number): Promise<void> {
  const { gsap } = await loadMotion();
  act(() => {
    for (const animation of gsap.globalTimeline.getChildren(true, true, false)) {
      animation.progress(progress);
    }
  });
}

function renderLogo() {
  const { container, unmount } = render(<HeaderLogo />);
  return { container, unmount, link: container.querySelector('a')! };
}

describe('useLogoHover', () => {
  beforeEach(async () => {
    await primeMotion();
  });

  afterEach(async () => {
    cleanup();
    await resetMotion();
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('keeps the body on its open and the wick on the crossbar at every point of the trade', async () => {
    stubMedia({ fine: true, reduce: false });
    const { container, link } = renderLogo();
    fireEvent.pointerEnter(link, { pointerType: 'mouse' });

    for (const progress of [0.1, 0.35, 0.6, 0.85, 1]) {
      await seekAll(progress);
      const g = geometry(container);
      expect(g.bodyBottom).toBeCloseTo(REST.bodyBottom);
      expect(g.wickTop).toBe(REST.wickTop);
      expect(g.wickBottom).toBeCloseTo(g.bodyTop);
      expect(g.bodyTop).toBeGreaterThanOrEqual(19);
      expect(g.bodyTop).toBeLessThanOrEqual(33);
      expect(g.lowHeight).toBeLessThanOrEqual(12);
    }
  });

  it('is a down candle exactly while the close is below rest', async () => {
    stubMedia({ fine: true, reduce: false });
    const { container, link } = renderLogo();
    const svg = container.querySelector('svg')!;
    fireEvent.pointerEnter(link, { pointerType: 'mouse' });

    for (const progress of [0.05, 0.2, 0.4, 0.55, 0.7, 0.9, 1]) {
      await seekAll(progress);
      const below = geometry(container).bodyTop > REST.bodyTop + 0.5;
      expect(svg.dataset.candleTrend ?? 'up').toBe(below ? 'down' : 'up');
    }
  });

  it('moves only the T: the wordmark stays still throughout', async () => {
    stubMedia({ fine: true, reduce: false });
    const { container, link } = renderLogo();
    const wordmark = container.querySelector<HTMLElement>('[data-wordmark]')!;
    fireEvent.pointerEnter(link, { pointerType: 'mouse' });
    for (const progress of [0.1, 0.5, 1]) {
      await seekAll(progress);
      expect(wordmark.style.transform).toBe('');
    }
  });

  it('lands the crossbar and keeps trading while hovered', async () => {
    stubMedia({ fine: true, reduce: false });
    const { container, link } = renderLogo();
    fireEvent.pointerEnter(link, { pointerType: 'mouse' });
    await finishMotion();

    const { gsap } = await loadMotion();
    expect(geometry(container).barY).toBe(REST.barY);
    const trading = gsap.globalTimeline
      .getChildren(true, true, false)
      .filter((animation) => animation.repeat() === -1);
    expect(trading).toHaveLength(1);
  });

  it('settles back to the exact resting mark on leave', async () => {
    stubMedia({ fine: true, reduce: false });
    const { container, link } = renderLogo();
    fireEvent.pointerEnter(link, { pointerType: 'mouse' });
    await seekAll(0.5);
    fireEvent.pointerLeave(link, { pointerType: 'mouse' });
    await finishMotion();
    await finishMotion();

    expect(geometry(container)).toEqual(REST);
    const { gsap } = await loadMotion();
    expect(container.querySelector('svg')!.dataset.candleTrend ?? 'up').toBe('up');
    expect(container.querySelector<SVGElement>('[data-candle="body"]')!.style.fill).toBe('');
    const stillTrading = gsap.globalTimeline
      .getChildren(true, true, false)
      .some((animation) => animation.repeat() === -1);
    expect(stillTrading).toBe(false);
  });

  it('hands the colour back to the theme token after recovering to green mid-hover', async () => {
    stubMedia({ fine: true, reduce: false });
    const { gsap } = await loadMotion();
    const random = vi.spyOn(gsap.utils, 'random');
    const { container, link } = renderLogo();
    const body = container.querySelector<SVGElement>('[data-candle="body"]')!;

    // Trades down (red) ...
    random.mockReturnValue(30);
    fireEvent.pointerEnter(link, { pointerType: 'mouse' });
    await finishMotion();
    expect(container.querySelector('svg')!.dataset.candleTrend).toBe('down');
    // ... recovers to green while still hovered ...
    fireEvent.pointerLeave(link, { pointerType: 'mouse' });
    random.mockReturnValue(20);
    fireEvent.pointerEnter(link, { pointerType: 'mouse' });
    await finishMotion();
    await finishMotion();
    expect(container.querySelector('svg')!.dataset.candleTrend).toBe('up');
    // ... then the pointer leaves: no inline colour may outlive the hover, or a theme
    // switch at rest would keep the old theme's green.
    fireEvent.pointerLeave(link, { pointerType: 'mouse' });
    await finishMotion();
    await finishMotion();
    expect(body.style.fill).toBe('');
  });

  it('restores the resting mark if the header unmounts mid-trade', async () => {
    stubMedia({ fine: true, reduce: false });
    const { container, link, unmount } = renderLogo();
    const svg = container.querySelector('svg')!;
    fireEvent.pointerEnter(link, { pointerType: 'mouse' });
    await seekAll(0.5);
    unmount();
    expect(geometry(svg)).toEqual(REST);
  });

  it.each([
    ['a touch', { fine: false, reduce: false }, 'touch'],
    ['reduced motion', { fine: true, reduce: true }, 'mouse'],
  ] as const)('stays at rest for %s', async (_label, media, pointerType) => {
    stubMedia(media);
    const { container, link } = renderLogo();
    fireEvent.pointerEnter(link, { pointerType });
    await finishMotion();
    expect(geometry(container)).toEqual(REST);
  });

  it('stays at rest while the greeting has the header logo hidden', async () => {
    stubMedia({ fine: true, reduce: false });
    const { container, link } = renderLogo();
    container.querySelector<HTMLElement>('[data-tckr-logo]')!.style.opacity = '0';
    fireEvent.pointerEnter(link, { pointerType: 'mouse' });
    await finishMotion();
    expect(geometry(container)).toEqual(REST);
  });
});
