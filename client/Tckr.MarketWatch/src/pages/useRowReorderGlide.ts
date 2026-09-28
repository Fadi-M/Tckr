import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { prefersReducedMotion } from '../components/prefersReducedMotion.ts';
import { loadMotion, loadedMotion, type Motion } from '../motion/motion.ts';

// A row's glide to its new rank; linear background hand-off for rows that moved.
const FLIP_DURATION_MS = 420;
const MOVING_ROW_BACKGROUND = 'color-mix(in oklab, var(--tckr-color-surface) 94%, transparent)';

/**
 * Re-rank motion (GSAP Flip), split out of `StockList`. When the row order changes (a
 * preset or header sort, the per-beat re-rank of an active sort, or a search narrowing
 * the list), each row that moved glides from where it was to its new rank, and rows newly
 * in the list fade in. Without it rows teleport, and the symbol you were watching is lost.
 *
 * The "before" is read during the render that changes the order, i.e. from the DOM React
 * is about to replace, so it is where each row *is on screen*, mid-glide included. A
 * re-rank that lands while the last one is still flying (a sort click, a search
 * keystroke) carries each row on from where it actually is, instead of snapping it back
 * to its old resting place first. (That read is the one layout read this render does,
 * only when the order changes; if React throws the render away, the next one reads
 * again.) The layout effect then clears the previous glide and plays this one before
 * paint: transform and opacity, plus a moving row's background (paint only, never
 * layout).
 *
 * Needs GSAP already loaded (`loadMotion` below): the first re-rank after a cold load may
 * land unanimated, never late.
 *
 * `tbodyRef` is the board's `<tbody>`; `orderKey` is its rendered symbol order joined with
 * commas.
 */
export function useRowReorderGlide(
  tbodyRef: RefObject<HTMLTableSectionElement | null>,
  orderKey: string,
): void {
  const committedOrderKeyRef = useRef<string | null>(null);
  const flipRef = useRef<{
    readonly orderKey: string;
    readonly state: ReturnType<Motion['Flip']['getState']>;
  } | null>(null);
  const glideRef = useRef<ReturnType<Motion['Flip']['from']> | null>(null);

  useEffect(() => {
    void loadMotion().catch(() => undefined);
  }, []);

  const flipMotion = loadedMotion();
  if (
    flipMotion !== null &&
    tbodyRef.current !== null &&
    committedOrderKeyRef.current !== null &&
    committedOrderKeyRef.current !== orderKey &&
    flipRef.current?.orderKey !== orderKey &&
    !prefersReducedMotion()
  ) {
    flipRef.current = {
      orderKey,
      state: flipMotion.Flip.getState(tbodyRef.current.querySelectorAll('tr[data-symbol]'), {
        simple: true,
      }),
    };
  }

  useLayoutEffect(() => {
    const tbody = tbodyRef.current;
    const pending = flipRef.current;
    const motion = loadedMotion();
    committedOrderKeyRef.current = tbody ? orderKey : null;
    flipRef.current = null;
    if (!tbody || !motion || pending?.orderKey !== orderKey) {
      return;
    }
    const { gsap, Flip } = motion;
    const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr[data-symbol]'));
    // The last glide's transforms are still inline; clear them so this one measures
    // the rows' true new places.
    glideRef.current?.kill();
    if (rows.length === 0) {
      // A search that matched nothing: the old flight is stopped and there is nothing to glide.
      return;
    }
    gsap.set(rows, { clearProps: 'transform,opacity' });
    const moved = rows.filter((row) => {
      const before = pending.state.getElementState(row);
      return before !== undefined && Math.abs(before.y - row.getBoundingClientRect().top) > 0.5;
    });
    const glide = Flip.from(pending.state, {
      targets: rows,
      duration: FLIP_DURATION_MS / 1000,
      simple: true,
      onEnter: (entering) =>
        gsap.fromTo(entering, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'power1.out' }),
    });
    // Rows are transparent over the glass, so rows crossing each other would overprint
    // their text. A moving row carries a near-opaque surface for the flight and only
    // hands back to its own background (the last keyframe omits it) once it has almost
    // landed — a separate, linear animation, because the glide's front-loaded ease-out
    // would thin the surface out almost at once. Web Animations rather than GSAP: it
    // fades to whatever the row's own background resolves to, selected tint included.
    for (const row of moved) {
      if (typeof row.animate === 'function') {
        row.animate(
          [
            { backgroundColor: MOVING_ROW_BACKGROUND },
            { backgroundColor: MOVING_ROW_BACKGROUND, offset: 0.7 },
            {},
          ],
          { duration: FLIP_DURATION_MS, easing: 'linear' },
        );
      }
    }
    glide.eventCallback('onComplete', () => {
      gsap.set(rows, { clearProps: 'transform,opacity' });
    });
    glideRef.current = glide;
  }, [tbodyRef, orderKey]);

  useEffect(
    () => () => {
      glideRef.current?.kill();
    },
    [],
  );
}
