/**
 * The header logo's hover: "a tick up". The candle's body rallies toward the T's
 * crossbar while the upper wick shortens to stay joined to it (body top and wick bottom
 * meet at the same y throughout), then settles back when the pointer leaves. The
 * candle stays Exchange Green (DESIGN.md, the Always-Green Candle Rule); only its shape
 * moves, and only by transform.
 *
 * - Mouse only, on a fine pointer: a tap never leaves the logo stuck mid-rally.
 * - Never on keyboard focus (focus shows the focus ring and nothing else).
 * - Nothing under reduced motion: the logo simply stays at rest.
 * - Interruptible: every tween retargets from wherever the shape is, so a quick
 *   in-out-in never snaps. Leaving is faster than arriving.
 * - Stands down while the daily greeting has the header logo hidden, since the
 *   greeting measures the mark to fly its lockup into place.
 */
import { useEffect, type RefObject } from 'react';
import { prefersReducedMotion } from '../components/prefersReducedMotion.ts';
import { loadedMotion, loadMotion, type Motion } from './motion.ts';

/** The body grows from its bottom edge; the upper wick shrinks toward the crossbar by
 * the same distance. Body 25..59 (34 units) × 1.1 = top at 21.6; wick 15..25 (10 units)
 * × 0.66 = bottom at 21.6. */
const BODY_RALLY = 1.1;
const WICK_RALLY = 0.66;
const ENTER = { duration: 0.26, ease: 'power3.out' } as const;
const LEAVE = { duration: 0.18, ease: 'power2.out' } as const;

const FINE_HOVER_QUERY = '(hover: hover) and (pointer: fine)';

function canHover(event: PointerEvent): boolean {
  return (
    event.pointerType === 'mouse' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(FINE_HOVER_QUERY).matches &&
    !prefersReducedMotion()
  );
}

export function useLogoHover(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = ref.current;
    const body = root?.querySelector<SVGElement>('[data-candle="body"]');
    const wick = root?.querySelector<SVGElement>('[data-candle="wick-high"]');
    if (!root || !body || !wick) {
      return undefined;
    }

    // The latest intent wins, so a hover that ends before GSAP has loaded doesn't
    // play late.
    let rallied = false;
    const apply = ({ gsap }: Motion): void => {
      const timing = rallied ? ENTER : LEAVE;
      gsap.to(body, {
        scaleY: rallied ? BODY_RALLY : 1,
        transformOrigin: '50% 100%',
        overwrite: 'auto',
        ...timing,
      });
      gsap.to(wick, {
        scaleY: rallied ? WICK_RALLY : 1,
        transformOrigin: '50% 0%',
        overwrite: 'auto',
        ...timing,
      });
    };
    const play = (next: boolean): void => {
      rallied = next;
      const motion = loadedMotion();
      if (motion) {
        apply(motion);
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
      if (rallied) {
        play(false);
      }
    };

    root.addEventListener('pointerenter', handleEnter);
    root.addEventListener('pointerleave', handleLeave);
    return () => {
      root.removeEventListener('pointerenter', handleEnter);
      root.removeEventListener('pointerleave', handleLeave);
      const motion = loadedMotion();
      if (motion) {
        motion.gsap.killTweensOf([body, wick]);
        motion.gsap.set([body, wick], { clearProps: 'transform' });
      }
    };
  }, [ref]);
}
