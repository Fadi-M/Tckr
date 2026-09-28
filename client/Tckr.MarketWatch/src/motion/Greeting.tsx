/**
 * The daily greeting: "The Candle Prints". Once per Cairo day, on whichever URL the
 * day starts (`greetingSchedule.ts`), Tckr opens with its own mark performing a session.
 *
 *   0.0s  The Frost field, its three glows dimmed, as if the lights are still coming up.
 *   0.2s  At hero scale the green candle forms (`candleTimeline`, the same one the
 *         opening bell uses): the low wick dips, the body rallies, the high wick
 *         pushes, the crossbar lands. A mint light swells behind it through the
 *         rally and settles. The field's glows bloom to full strength.
 *   1.1s  "ckr" resolves beside the mark in mono.
 *   1.4s  A salutation for the hour in Cairo rises word by word, then the market's
 *         true state prints left to right beside its signal dot.
 *   2.8s  The hand-off, one continuous movement from its first frame. The words lift
 *         away as the lockup sets off (`tckr-flight`: leaves at once, spends its time
 *         arriving) into the header logo's exact place and becomes it. The overlay's
 *         field, drawn from the same tokens and the same `FrostGlows` as the page,
 *         dissolves into the identical field beneath, so only the content appears. The
 *         page's panes (`data-greet-rise`) settle up into place from just below.
 *   ~3.9s The page, live, with nothing having jumped and nothing having waited.
 *
 * Never in the way. Any key, click, tap or scroll plays the rest of the introduction
 * through quickly (it never cuts) and goes straight to the hand-off. The page underneath
 * is live and fully accessible throughout: the overlay is decorative (`aria-hidden`),
 * it passes pointer input through once the hand-off starts, and keys still reach the
 * page. Under reduced motion there is no flight and no movement: the finished lockup
 * and the two lines appear, hold a moment, and fade away.
 *
 * Every motion is transform, opacity, an SVG attribute, a clip or a mask. The
 * risen panes are moved with transforms only, never faded: opacity below 1 on an
 * ancestor of the glass panes would change what their backdrop blur samples, and the
 * glass would visibly snap when it returned to 1.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FrostGlows } from '../components/FrostGlows.tsx';
import { TckrLogo } from '../components/TckrLogo.tsx';
import { prefersReducedMotion } from '../components/prefersReducedMotion.ts';
import { useMarketStatus } from '../components/useMarketStatus.ts';
import { candleTimeline } from './FormingCandle.tsx';
import { greetingCopy, type GreetingTone } from './greetingCopy.ts';
import { markGreeted } from './greetingSchedule.ts';
import { loadMotion, type Motion } from './motion.ts';

/** If GSAP can't load, the overlay fades away on its own after this long. */
const FAILSAFE_MS = 4500;

const TONE_DOT: Record<GreetingTone, string> = {
  trading: 'bg-up shadow-[0_0_0_4px_color-mix(in_oklab,var(--tckr-color-up)_18%,transparent)]',
  waiting: 'bg-warning',
  closed: 'bg-text-muted',
};

export function Greeting({ onDone }: { readonly onDone: () => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [handingOff, setHandingOff] = useState(false);
  // Read once: the greeting says what was true when it began, and doesn't re-word
  // itself mid-performance if a minute ticks over.
  const status = useMarketStatus();
  const copy = useMemo(() => greetingCopy(status, Date.now()), []); // eslint-disable-line react-hooks/exhaustive-deps
  // The hero lockup's wordmark size: the header's lockup (24px) scaled up.
  const heroSize = useMemo(() => (window.innerWidth < 640 ? 60 : 96), []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) {
      return undefined;
    }
    markGreeted(Date.now());
    const reduced = prefersReducedMotion();
    // The header's own lockup, which the hero lockup becomes. Hidden until it lands, so
    // there is only ever one Tckr on screen (not under reduced motion, where nothing
    // flies and the header's lockup is simply revealed as the overlay fades).
    const headerLogo = document.querySelector<HTMLElement>('header [data-tckr-logo]');
    if (headerLogo && !reduced) {
      headerLogo.style.opacity = '0';
    }

    let cancelled = false;
    let finished = false;
    let context: ReturnType<Motion['gsap']['context']> | null = null;
    const removeListeners: Array<() => void> = [];

    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      if (headerLogo) {
        headerLogo.style.opacity = '';
      }
      onDone();
    };

    // GSAP never arrived: step aside quietly rather than hold the page.
    const failsafe = window.setTimeout(() => {
      root.style.transition = 'opacity 500ms ease';
      root.style.opacity = '0';
      root.style.pointerEvents = 'none';
      window.setTimeout(finish, 500);
    }, FAILSAFE_MS);

    const play = (motion: Motion) => {
      const { gsap, SplitText } = motion;
      const q = gsap.utils.selector(root);
      const field = q('[data-greet-field]')[0]!;
      const glows = q('[data-frost-glow]');
      const light = q('[data-greet-light]')[0]!;
      const lockup = q('[data-greet-lockup]')[0]!;
      const wordmark = q('[data-greet-lockup] [data-wordmark]')[0]!;
      const salutation = q('[data-greet-salutation]')[0]!;
      const market = q('[data-greet-market]')[0]!;
      const lines = [salutation, market];

      if (reduced) {
        // Stillness: the finished lockup and the two lines, then a soft fade.
        gsap
          .timeline({ onComplete: finish })
          .fromTo(
            [lockup, ...lines],
            { autoAlpha: 0 },
            { autoAlpha: 1, duration: 0.4, ease: 'power1.out' },
          )
          .to(root, { autoAlpha: 0, duration: 0.6, ease: 'power1.inOut' }, '+=1.3');
        return;
      }

      // --- The introduction -------------------------------------------------------
      // The wordmark's box is fixed at its finished width, so the lockup doesn't
      // re-centre as "ckr" resolves character by character.
      gsap.set(wordmark, {
        width: wordmark.getBoundingClientRect().width,
        display: 'inline-block',
        textAlign: 'left',
      });
      wordmark.textContent = '';
      const words = SplitText.create(salutation, {
        type: 'words',
        mask: 'words',
        aria: 'none',
      }).words;
      // Every start state is set here, explicitly and at once, rather than left to
      // `from()` tweens in a paused timeline: nothing may paint in its finished state
      // first and then jump back to its start.
      gsap.set(words, { yPercent: 110, filter: 'blur(6px)' });
      gsap.set(salutation, { autoAlpha: 1 });
      gsap.set(market, { autoAlpha: 1, clipPath: 'inset(-20% 100% -20% 0)' });
      gsap.set(q('[data-greet-dot]'), { scale: 0 });
      gsap.set(glows, { opacity: 0.12 });
      gsap.set(light, { opacity: 0, scale: 0.55 });

      const intro = gsap.timeline({ paused: true });
      intro
        .set(lockup, { autoAlpha: 1 }, 0)
        // The lights come up. Opacity only: the glows are 70px blurs, and scaling one
        // would re-rasterise its blur every frame; faded, the blur is computed once.
        .to(glows, { opacity: 1, duration: 2.5, ease: 'sine.inOut' }, 0)
        // The candle light swells with the rally, then settles to an ember.
        .to(light, { opacity: 0.95, scale: 1.12, duration: 0.9, ease: 'power2.out' }, 0.35)
        .to(light, { opacity: 0.4, scale: 1, duration: 1.1, ease: 'sine.inOut' }, 1.25)
        // "ckr" resolves.
        .to(
          wordmark,
          {
            duration: 0.55,
            ease: 'none',
            scrambleText: { text: 'ckr', chars: 'lowerCase', speed: 0.5 },
          },
          1.08,
        )
        // The salutation rises through its mask, word by word, coming into focus.
        .to(
          words,
          { yPercent: 0, filter: 'blur(0px)', duration: 0.85, stagger: 0.08, ease: 'tckr-out' },
          1.38,
        )
        // The market line prints left to right.
        .to(
          market,
          { clipPath: 'inset(-20% 0% -20% 0)', duration: 0.75, ease: 'power2.inOut' },
          1.7,
        )
        .to(q('[data-greet-dot]'), { scale: 1, duration: 0.45, ease: 'back.out(3)' }, 1.72)
        // A beat to read it.
        .to({}, { duration: 0.35 });
      // Slightly slower than the opening bell's candle: this is the hero take.
      const candle = candleTimeline(motion, lockup);
      if (candle) {
        intro.add(candle.timeScale(0.85), 0.18);
      }

      // --- The hand-off -----------------------------------------------------------
      let handedOff = false;
      const handOff = () => {
        if (handedOff || cancelled) {
          return;
        }
        handedOff = true;
        setHandingOff(true);
        const panes = Array.from(
          document.querySelectorAll<HTMLElement>('main [data-greet-rise]'),
        ).filter((el) => el.offsetParent !== null);
        // Everything that moves in the hand-off is promoted to its own layer for just
        // its duration: the field's opacity and the lockup's and panes' transforms are
        // then composited, never repainted (the field holds three 70px blurs).
        gsap.set(field, { willChange: 'opacity' });
        gsap.set([lockup, ...panes], { willChange: 'transform', force3D: true });
        const out = gsap.timeline({
          onComplete: () => {
            gsap.set([field, lockup, ...panes], { clearProps: 'willChange' });
            finish();
          },
        });
        // One continuous movement from the first frame: the lockup sets off as the
        // words lift, the field starts to thin, and the panes start to settle, so
        // nothing waits in line and nothing ever stands still.
        out
          .to(
            lines,
            {
              y: -10,
              autoAlpha: 0,
              filter: 'blur(4px)',
              duration: 0.32,
              stagger: 0.04,
              ease: 'power2.in',
            },
            0,
          )
          .to(light, { opacity: 0, scale: 0.85, duration: 0.45, ease: 'power1.in' }, 0)
          // The field dissolves into the identical field beneath it.
          .to(field, { opacity: 0, duration: 0.75, ease: 'power1.inOut' }, 0.12)
          // The panes settle up into place from just below: translation only (a scale
          // would re-raster their text every frame).
          .from(
            panes,
            { y: 26, duration: 0.9, stagger: 0.05, ease: 'tckr-out', clearProps: 'transform' },
            0.16,
          );
        const heroMarkEl = lockup.querySelector('svg');
        const homeMarkEl = headerLogo?.querySelector('svg');
        const measurable =
          heroMarkEl &&
          homeMarkEl &&
          heroMarkEl.getBoundingClientRect().height > 0 &&
          homeMarkEl.getBoundingClientRect().height > 0;
        if (headerLogo && measurable) {
          // The lockup flies home and becomes the header's. One uniform scale, from the
          // hero mark's height to the header mark's, about the mark's bottom-left
          // corner, which travels to the header mark's: the two lockups round their gaps
          // differently at their sizes, so fitting the whole box would stretch the mark
          // by a pixel and it would tick as they swap. Anchored on the mark, the swap
          // is sub-pixel.
          const heroMark = heroMarkEl.getBoundingClientRect();
          const homeMark = homeMarkEl.getBoundingClientRect();
          const box = lockup.getBoundingClientRect();
          gsap.set(lockup, {
            transformOrigin: `${heroMark.left - box.left}px ${heroMark.bottom - box.top}px`,
          });
          const scale = homeMark.height / heroMark.height;
          const flight = { duration: 0.95, ease: 'tckr-flight' } as const;
          out.to(
            lockup,
            {
              x: homeMark.left - heroMark.left,
              y: homeMark.bottom - heroMark.bottom,
              scale,
              ...flight,
            },
            0,
          );
          // The same rounding leaves "ckr" most of a pixel off its home; it drifts that
          // last fraction during the flight, so it lands on the header's wordmark too.
          const heroWord = wordmark.getBoundingClientRect();
          const homeWord = headerLogo.querySelector('[data-wordmark]')!.getBoundingClientRect();
          const landsAt = homeMark.left + (heroWord.left - heroMark.left) * scale;
          out.to(wordmark, { x: (homeWord.left - landsAt) / scale, ...flight }, 0);
          out.add(() => {
            headerLogo.style.opacity = '';
            gsap.set(lockup, { autoAlpha: 0 });
          });
        } else {
          // Nowhere measurable to fly to: the lockup fades with the field, and the
          // header's own lockup is simply there underneath.
          if (headerLogo) {
            headerLogo.style.opacity = '';
          }
          out.to(lockup, { autoAlpha: 0, duration: 0.5 }, 0.3);
        }
      };
      intro.eventCallback('onComplete', handOff);

      // Any key, click, tap or scroll: play the rest of the introduction through
      // quickly and hand off. Never a cut.
      let skipping = false;
      const skip = () => {
        if (skipping || handedOff) {
          return;
        }
        skipping = true;
        intro.pause();
        gsap.to(intro, {
          time: intro.duration(),
          duration: 0.45,
          ease: 'power2.inOut',
          onComplete: handOff,
        });
      };
      for (const type of ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const) {
        window.addEventListener(type, skip, { passive: true });
        removeListeners.push(() => window.removeEventListener(type, skip));
      }

      intro.play();
    };

    loadMotion().then(
      (motion) => {
        if (cancelled) {
          return;
        }
        window.clearTimeout(failsafe);
        context = motion.gsap.context(() => play(motion), root);
      },
      () => undefined,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(failsafe);
      removeListeners.forEach((remove) => remove());
      context?.revert();
      if (headerLogo) {
        headerLogo.style.opacity = '';
      }
    };
    // Runs once: the greeting is a single performance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      data-testid="tckr-greeting"
      className={`fixed inset-0 z-[60] overflow-hidden ${handingOff ? 'pointer-events-none' : ''}`}
    >
      {/* The field: the page's own gradient and glows, drawn over it. */}
      <div data-greet-field className="absolute inset-0 bg-[image:var(--tckr-bg-gradient)]">
        <FrostGlows layer="overlay" />
        <span
          data-greet-light
          className="absolute left-1/2 top-1/2 w-[min(78vw,640px)] aspect-square -mt-[calc(min(78vw,640px)*0.58)] -ml-[calc(min(78vw,640px)*0.5)] rounded-full opacity-0 bg-[radial-gradient(circle,var(--tckr-blob-a)_0%,color-mix(in_oklab,var(--tckr-blob-a)_40%,transparent)_30%,transparent_64%)]"
        />
      </div>

      <div className="relative h-full flex flex-col items-center justify-center gap-7 px-6 text-center max-[640px]:gap-5">
        {/* Hidden until GSAP has collapsed the candle, so the finished mark never shows
            first and then snaps shut. */}
        <span data-greet-lockup className="inline-flex invisible opacity-0">
          <TckrLogo size={heroSize} />
        </span>
        <div className="flex flex-col items-center gap-3">
          <p
            data-greet-salutation
            className="invisible font-sans font-medium text-headline tracking-[-0.01em] text-text"
          >
            {copy.salutation}
          </p>
          <p
            data-greet-market
            className="invisible inline-flex items-center gap-2.5 font-mono text-caption font-semibold tracking-[0.08em] uppercase text-text-muted"
          >
            <span
              data-greet-dot
              className={`w-1.5 h-1.5 rounded-full flex-none ${TONE_DOT[copy.tone]}`}
            />
            {copy.market}
          </p>
        </div>
      </div>
    </div>
  );
}
