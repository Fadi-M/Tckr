/**
 * The header logo's hover: the candle comes to life and trades. Only the T moves; "ckr"
 * stays still.
 *
 * 1. **The open** (~0.4s): the T's crossbar pops up and lands with an overshoot, like a
 *    bell strike, the body rallies and the lower wick dips.
 * 2. **Live** (while the pointer stays): the close moves to a new price level every
 *    ~0.45s. The body grows or shrinks from its open (its bottom edge), and the upper
 *    wick always stretches to meet the crossbar, so the T stays whole while it trades.
 *    While the close is below where it rests, the candle is a down candle and turns the
 *    down colour; back above it, green again.
 * 3. **Leave** (0.22s): everything settles back to the resting, green mark from wherever
 *    it is.
 *
 * Only this hover may colour the logo's candle anything but green (DESIGN.md, the
 * Always-Green Candle Rule and its one exception). Like `FormingCandle`, it tweens the SVG
 * parts' own attributes, read from the DOM, so the logo geometry lives only in
 * `TckrLogo.tsx`.
 *
 * Mouse on a fine pointer only (a tap never leaves it trading), never on keyboard focus,
 * nothing under reduced motion, and not while the daily greeting has the header logo
 * hidden (the greeting measures the mark to fly its lockup into place).
 */
import { useEffect, type RefObject } from 'react';
import { prefersReducedMotion } from '../components/prefersReducedMotion.ts';
import { loadedMotion, loadMotion, type Motion } from './motion.ts';

const FINE_HOVER_QUERY = '(hover: hover) and (pointer: fine)';

/** Where the close (the body's top edge, in viewBox units) may trade while hovered: from
 * a strong rally (a 4-unit upper wick) to a pullback (a 26-unit body). Rest is 25. */
const CLOSE_HIGH = 19;
const CLOSE_LOW = 33;
/** The open's first rally, then how far the lower wick dips (it stays inside the 72-unit
 * viewBox: 59 + 12 = 71). */
const OPEN_RALLY_CLOSE = 20;
const DIP_LOW_WICK = 12;
/** The crossbar's pop, in viewBox units; it rises past the viewBox top, so the header's
 * mark is allowed to overflow its box (below) instead of clipping it flat. */
const BAR_POP = 7;
/** A close this far (viewBox units) below rest counts as down, so a close hovering right
 * at rest doesn't flicker between colours. */
const DOWN_MARGIN = 0.5;
/** Resolved per change, so a theme switch mid-hover gets the right pair; the fallbacks
 * are the light-theme tokens. */
const UP_TOKEN = ['--tckr-logo-candle', '#0f7a4d'] as const;
const DOWN_TOKEN = ['--tckr-color-down', '#c0392b'] as const;

type Trend = 'up' | 'down';

function canHover(event: PointerEvent): boolean {
  return (
    event.pointerType === 'mouse' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(FINE_HOVER_QUERY).matches &&
    !prefersReducedMotion()
  );
}

interface Parts {
  readonly svg: SVGSVGElement;
  readonly bar: SVGRectElement;
  readonly high: SVGRectElement;
  readonly body: SVGRectElement;
  readonly low: SVGRectElement;
}

function findParts(root: Element): Parts | null {
  const q = <T extends Element>(selector: string) => root.querySelector<T>(selector);
  const bar = q<SVGRectElement>('[data-candle="bar"]');
  const high = q<SVGRectElement>('[data-candle="wick-high"]');
  const body = q<SVGRectElement>('[data-candle="body"]');
  const low = q<SVGRectElement>('[data-candle="wick-low"]');
  const svg = bar?.ownerSVGElement;
  return svg && bar && high && body && low ? { svg, bar, high, body, low } : null;
}

export function useLogoHover(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = ref.current;
    const parts = root ? findParts(root) : null;
    if (!root || !parts) {
      return undefined;
    }
    const { svg, bar, high, body, low } = parts;
    const candle = [high, body, low];
    svg.setAttribute('overflow', 'visible');
    const num = (el: Element, attr: string) => Number(el.getAttribute(attr));
    const rest = {
      barY: num(bar, 'y'),
      highY: num(high, 'y'),
      close: num(body, 'y'),
      open: num(body, 'y') + num(body, 'height'),
      lowH: num(low, 'height'),
    };
    const colour = ([token, fallback]: readonly [string, string]): string =>
      getComputedStyle(root).getPropertyValue(token).trim() || fallback;

    let hovered = false;
    let motion: Motion | null = null;
    let trend: Trend = 'up';
    // Everything this hook has playing, so a change of intent stops exactly that.
    let running: (gsap.core.Timeline | gsap.core.Tween)[] = [];
    let colourTween: gsap.core.Tween | null = null;

    const setTrend = (next: Trend): void => {
      if (next === trend || !motion) {
        return;
      }
      trend = next;
      svg.dataset.candleTrend = next;
      colourTween?.kill();
      colourTween = motion.gsap.to(candle, {
        fill: colour(next === 'down' ? DOWN_TOKEN : UP_TOKEN),
        duration: 0.18,
        ease: 'power2.out',
        onComplete: () => {
          // Back to green and at rest: hand the colour back to the SVG's own token.
          if (next === 'up' && !hovered) {
            motion?.gsap.set(candle, { clearProps: 'fill' });
          }
        },
      });
    };

    // One number drives the body, the upper wick and the colour, so none of them can
    // disagree about the price.
    const price = { close: rest.close };
    const drawClose = (): void => {
      body.setAttribute('y', String(price.close));
      body.setAttribute('height', String(rest.open - price.close));
      high.setAttribute('height', String(price.close - rest.highY));
      setTrend(price.close > rest.close + DOWN_MARGIN ? 'down' : 'up');
    };

    const stopAll = (): void => {
      running.forEach((animation) => {
        animation.kill();
      });
      running = [];
    };

    const open = ({ gsap }: Motion): void => {
      stopAll();
      const flourish = gsap
        .timeline()
        .to(bar, { attr: { y: rest.barY - BAR_POP }, duration: 0.12, ease: 'power2.out' }, 0)
        .to(bar, { attr: { y: rest.barY }, duration: 0.4, ease: 'back.out(3)' }, 0.12)
        .to(low, { attr: { height: DIP_LOW_WICK }, duration: 0.16, ease: 'power2.out' }, 0)
        .to(low, { attr: { height: rest.lowH }, duration: 0.3, ease: 'power2.inOut' }, 0.16)
        .to(
          price,
          { close: OPEN_RALLY_CLOSE, duration: 0.3, ease: 'power3.out', onUpdate: drawClose },
          0,
        );
      // Then it trades: a new close every beat, for as long as the pointer stays.
      const trading = gsap.to(price, {
        close: () => gsap.utils.random(CLOSE_HIGH, CLOSE_LOW, 1),
        duration: 0.32,
        ease: 'power2.inOut',
        onUpdate: drawClose,
        delay: 0.34,
        repeat: -1,
        repeatDelay: 0.13,
        repeatRefresh: true,
      });
      running = [flourish, trading];
    };

    const settle = ({ gsap }: Motion): void => {
      stopAll();
      const back = { duration: 0.22, ease: 'power3.out' } as const;
      // At rest the candle's colour belongs to the SVG's own token again, so a theme switch
      // recolours it. A colour change still in flight clears it itself when it lands.
      const releaseColour = (): void => {
        if (!colourTween?.isActive()) {
          gsap.set(candle, { clearProps: 'fill' });
        }
      };
      running = [
        gsap.to(price, {
          close: rest.close,
          onUpdate: drawClose,
          onComplete: releaseColour,
          ...back,
        }),
        gsap.to(bar, { attr: { y: rest.barY }, ...back }),
        gsap.to(low, { attr: { height: rest.lowH }, ...back }),
      ];
    };

    // The latest intent wins, so a hover that ends before GSAP has loaded doesn't
    // play late.
    const apply = (loaded: Motion): void => {
      motion = loaded;
      if (hovered) {
        open(loaded);
      } else {
        settle(loaded);
      }
    };
    const play = (next: boolean): void => {
      hovered = next;
      const loaded = loadedMotion();
      if (loaded) {
        apply(loaded);
      } else {
        void loadMotion()
          .then(apply)
          .catch(() => undefined);
      }
    };

    const greetingHidesLogo = (): boolean =>
      root.querySelector<HTMLElement>('[data-tckr-logo]')?.style.opacity === '0';
    const handleEnter = (event: PointerEvent): void => {
      if (canHover(event) && !greetingHidesLogo()) {
        play(true);
      }
    };
    const handleLeave = (): void => {
      if (hovered) {
        play(false);
      }
    };

    root.addEventListener('pointerenter', handleEnter);
    root.addEventListener('pointerleave', handleLeave);
    return () => {
      root.removeEventListener('pointerenter', handleEnter);
      root.removeEventListener('pointerleave', handleLeave);
      stopAll();
      colourTween?.kill();
      motion?.gsap.set(candle, { clearProps: 'fill' });
      body.setAttribute('y', String(rest.close));
      body.setAttribute('height', String(rest.open - rest.close));
      high.setAttribute('height', String(rest.close - rest.highY));
      bar.setAttribute('y', String(rest.barY));
      low.setAttribute('height', String(rest.lowH));
      svg.removeAttribute('overflow');
      delete svg.dataset.candleTrend;
    };
  }, [ref]);
}
