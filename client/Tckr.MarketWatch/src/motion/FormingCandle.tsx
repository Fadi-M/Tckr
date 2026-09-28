/**
 * FormingCandle — the Tckr mark drawing itself the way a green candle forms over a
 * session: the price dips below the open (the lower wick grows down), rallies (the
 * body rises from the open to the close), tests a high (the upper wick), and the T's
 * crossbar drops on to finish the letter. About a second, once.
 *
 * Used where the brand earns a moment: the opening-bell banner (once, when EGX opens
 * while the page is open) and, looping, the board's loading state. The candle is
 * Exchange Green throughout (The Always-Green Candle Rule); only geometry moves.
 *
 * It animates the SVG attributes of `TckrMark`'s own parts (`data-candle`), read from
 * the DOM rather than copied, so the logo geometry still lives in exactly one place.
 * Attributes, not transforms: an SVG transform origin needs `getBBox()`, which a
 * transform-free attribute tween does not.
 *
 * Under reduced motion (or before GSAP has loaded) it is simply the static mark.
 */
import { useRef } from 'react';
import { TckrMark } from '../components/TckrLogo.tsx';
import { useMotion, type Motion } from './motion.ts';

function part(root: Element, name: string): SVGRectElement | null {
  return root.querySelector<SVGRectElement>(`[data-candle="${name}"]`);
}

function num(el: Element, attr: string): number {
  return Number(el.getAttribute(attr));
}

/**
 * The forming timeline, from the mark's resting geometry: collapses the candle at once,
 * then draws it. Shared with the daily greeting (`Greeting.tsx`), which plays it at hero
 * scale inside its own timeline. `vars` are the timeline's own (delay, repeat, …).
 */
export function candleTimeline(
  { gsap }: Motion,
  root: Element,
  vars: gsap.TimelineVars = {},
): gsap.core.Timeline | null {
  const bar = part(root, 'bar');
  const high = part(root, 'wick-high');
  const body = part(root, 'body');
  const low = part(root, 'wick-low');
  if (!bar || !high || !body || !low) {
    return null;
  }
  const bodyY = num(body, 'y');
  const bodyH = num(body, 'height');
  const highY = num(high, 'y');
  const highH = num(high, 'height');
  const lowH = num(low, 'height');
  const barY = num(bar, 'y');

  // Collapse the candle now, explicitly, rather than leaning on `from()`'s immediate
  // render (which a delayed timeline doesn't do): the resting mark must never paint
  // first and then snap shut.
  gsap.set(low, { attr: { height: 0 } });
  gsap.set(body, { attr: { y: bodyY + bodyH, height: 0 } });
  gsap.set(high, { attr: { y: highY + highH, height: 0 } });
  gsap.set(bar, { attr: { y: barY - 14 }, opacity: 0 });

  const tl = gsap.timeline(vars);
  // The dip: the low wick grows down from the open (the body's bottom edge).
  tl.to(low, { attr: { height: lowH }, duration: 0.22, ease: 'power2.out' })
    // The rally: the body rises from the open to the close.
    .to(body, { attr: { y: bodyY, height: bodyH }, duration: 0.5 }, '-=0.02')
    // The high: the upper wick pushes on past the close.
    .to(high, { attr: { y: highY, height: highH }, duration: 0.2, ease: 'power2.out' }, '-=0.1')
    // The crossbar lands, finishing the T.
    .to(bar, { attr: { y: barY }, opacity: 1, duration: 0.38, ease: 'back.out(2.2)' }, '-=0.06');
  return tl;
}

export function FormingCandle({
  height,
  loop = false,
}: {
  readonly height: number;
  readonly loop?: boolean;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useMotion(
    ref,
    (motion, root) => {
      candleTimeline(
        motion,
        root,
        loop ? { repeat: -1, yoyo: true, repeatDelay: 0.5, delay: 0.1 } : { delay: 0.18 },
      );
    },
    [loop],
  );
  return (
    <span ref={ref} className="inline-flex" aria-hidden="true">
      <TckrMark height={height} />
    </span>
  );
}
