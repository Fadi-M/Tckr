/**
 * The header logo's hover (`useLogoHover`): a mouse on a fine pointer rallies the candle
 * and leaving settles it; touch, reduced motion and the greeting's hidden logo leave it
 * at rest. Asserts end states (jsdom paints nothing), via `finishMotion`. jsdom has no SVG
 * geometry, so that the body and wick stay joined is checked in a real browser, not here.
 */
import { useRef } from 'react';
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

/** jsdom has no SVG layout, so each rect reports its own geometry for GSAP's origins. */
function stubSvgBBox(): void {
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true,
    value(this: SVGElement) {
      const n = (name: string) => Number(this.getAttribute(name) ?? 0);
      return { x: n('x'), y: n('y'), width: n('width'), height: n('height') };
    },
  });
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

async function scaleY(element: Element): Promise<number> {
  const { gsap } = await loadMotion();
  return Number(gsap.getProperty(element, 'scaleY'));
}

function parts(container: HTMLElement) {
  return {
    link: container.querySelector('a')!,
    body: container.querySelector('[data-candle="body"]')!,
    wick: container.querySelector('[data-candle="wick-high"]')!,
  };
}

describe('useLogoHover', () => {
  beforeEach(async () => {
    stubSvgBBox();
    await primeMotion();
  });

  afterEach(async () => {
    cleanup();
    await resetMotion();
    Reflect.deleteProperty(window, 'matchMedia');
    Reflect.deleteProperty(SVGElement.prototype, 'getBBox');
  });

  it('rallies the candle under a mouse and settles it on leave', async () => {
    stubMedia({ fine: true, reduce: false });
    const { link, body, wick } = parts(render(<HeaderLogo />).container);

    fireEvent.pointerEnter(link, { pointerType: 'mouse' });
    await finishMotion();
    expect(await scaleY(body)).toBeCloseTo(1.1);
    expect(await scaleY(wick)).toBeCloseTo(0.66);

    fireEvent.pointerLeave(link, { pointerType: 'mouse' });
    await finishMotion();
    expect(await scaleY(body)).toBeCloseTo(1);
    expect(await scaleY(wick)).toBeCloseTo(1);
  });

  it.each([
    ['a touch', { fine: false, reduce: false }, 'touch'],
    ['reduced motion', { fine: true, reduce: true }, 'mouse'],
  ] as const)('stays at rest for %s', async (_label, media, pointerType) => {
    stubMedia(media);
    const { link, body } = parts(render(<HeaderLogo />).container);
    fireEvent.pointerEnter(link, { pointerType });
    await finishMotion();
    expect(await scaleY(body)).toBe(1);
  });

  it('stays at rest while the greeting has the header logo hidden', async () => {
    stubMedia({ fine: true, reduce: false });
    const { container } = render(<HeaderLogo />);
    const { link, body } = parts(container);
    container.querySelector<HTMLElement>('[data-tckr-logo]')!.style.opacity = '0';
    fireEvent.pointerEnter(link, { pointerType: 'mouse' });
    await finishMotion();
    expect(await scaleY(body)).toBe(1);
  });
});
