/**
 * ScrambleWord — a mono label that resolves from `from` to `text` through random
 * capitals, like a departures board settling. Used for the labels that change state,
 * never for a figure: the stream badge's LIVE ↔ DELAYED, and the hero cards' session
 * day when EGX closes. A price is never scrambled — every intermediate frame would be
 * a number that never traded.
 *
 * Plays once, when it mounts with a `from` (the parent remounts it, with a `key`, to
 * play again); `from` is ignored after mount, so re-renders never replay it. Without a
 * `from`, or under reduced motion, it is plain text.
 *
 * Always `aria-hidden`: the intermediate strings are noise, and inside a live region a
 * screen reader would read every one. The parent supplies the accessible text.
 *
 * The scramble writes the element's text directly, so the element must hold nothing
 * but `text` and `text` must not change while it is mounted — callers key it on the
 * text.
 */
import { useRef } from 'react';
import { useMotion } from './motion.ts';

const DURATION_S = 0.6;

export function ScrambleWord({
  text,
  from,
  delay = 0,
  className,
}: {
  readonly text: string;
  readonly from?: string | undefined;
  /** Seconds before it starts resolving, to stagger several labels. */
  readonly delay?: number;
  readonly className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const fromAtMount = useRef(from).current;
  useMotion(
    ref,
    fromAtMount === undefined || fromAtMount === text
      ? null
      : ({ gsap }, root) => {
          root.textContent = fromAtMount;
          const tween = gsap.to(root, {
            duration: DURATION_S,
            delay,
            ease: 'none',
            scrambleText: {
              text,
              chars: 'upperCase',
              tweenLength: true,
              revealDelay: DURATION_S * 0.35,
              speed: 0.6,
            },
          });
          // Start scrambled on the first painted frame. Left to the next tick, the old
          // word would paint once in the new state's pill — one frame of "LIVE" on an
          // amber DELAYED badge, which is exactly the claim that pill must never make.
          if (delay === 0) {
            tween.progress(0.01);
          }
        },
    [],
  );
  return (
    <span ref={ref} className={className} aria-hidden="true">
      {text}
    </span>
  );
}
