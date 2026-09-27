/**
 * RollingText — how a changed figure lands.
 *
 * Only the characters that actually changed move: `85.60` → `85.64` rolls the `4` and
 * leaves `85.6` still, so the eye goes straight to the digit that moved instead of
 * re-reading a whole repainted cell. The new tail rises (or drops, for a down move) into
 * place while the old one leaves the other way, like a split-flap reel with its
 * mechanics taken out.
 *
 * The outgoing text is a CSS pseudo-element (`data-prev`, with an empty alternative
 * text), so it is never in the DOM's text or the accessible name: a reader, a copy, or a
 * test sees only the current value, even mid-roll.
 *
 * Timing reads `--tckr-tick-delay` from any ancestor (the board staggers its rows by
 * it), so a board repaint travels down the table rather than landing in one frame.
 */
import { useEffect, useRef, type ReactNode } from 'react';

export type RollDirection = 'up' | 'down';

/**
 * How long a landing keeps its animation classes: the longest landing animation (the
 * board's 1.6s arrow) plus the board's largest row delay, with a little slack. After
 * that the figure renders plain again. This matters beyond tidiness: a browser restarts a
 * CSS animation when its element is re-inserted, and re-sorting the board or opening a
 * symbol moves rows. A finished landing that still carried its classes would replay on
 * every move, as though every price had just changed.
 */
export const LANDING_WINDOW_MS = 2000;

/**
 * A figure replaced within this long of first appearing lands without animating: nobody
 * has read it yet, so swapping it is not a change anyone saw. (Opening a symbol paints
 * its snapshot and then, one render later, a tick that arrived while it loaded.)
 */
export const SETTLE_MS = 400;

/** Whether a figure shown since `since` (`performance.now()` time) has been on screen
 * long enough for its replacement to read as a change. */
export function hasSettled(since: number): boolean {
  return performance.now() - since >= SETTLE_MS;
}

/** Whether a landing that started at `at` (`performance.now()` time) is still playing. */
export function isLanding(at: number): boolean {
  return performance.now() - at < LANDING_WINDOW_MS;
}

/** Index of the first character that differs; 0 when the lengths differ (a new digit
 * count or sign moves the whole figure). */
export function changedFrom(previous: string, next: string): number {
  if (previous.length !== next.length) {
    return 0;
  }
  let i = 0;
  while (i < next.length && previous[i] === next[i]) {
    i++;
  }
  return i;
}

const ROLL_CLASSES: Record<RollDirection, string> = {
  up: 'animate-tick-in-up after:animate-tick-out-up',
  down: 'animate-tick-in-down after:animate-tick-out-down',
};

export interface RollingTextProps {
  readonly text: string;
  /** The text shown before this change, or `null` when there is no change to show. */
  readonly previous: string | null;
  readonly direction?: RollDirection;
}

export function RollingText({ text, previous, direction = 'up' }: RollingTextProps): ReactNode {
  if (previous === null || previous === text) {
    return text;
  }
  const cut = changedFrom(previous, text);
  return (
    <>
      {text.slice(0, cut)}
      <span
        key={text}
        data-prev={previous.slice(cut)}
        className={`relative inline-block ${ROLL_CLASSES[direction]} after:absolute after:right-0 after:top-0 after:whitespace-pre after:[content:attr(data-prev)_/_''] motion-reduce:animate-none motion-reduce:after:hidden`}
      >
        {text.slice(cut)}
      </span>
    </>
  );
}

interface TextLanding {
  readonly text: string;
  readonly previous: string;
  readonly at: number;
}

/**
 * A plain string that rolls its changed characters whenever it changes — for figures
 * that are formatted before they get here (the board's change-percent chip, the
 * detail's change pills) rather than going through `PriceCell`. Same rules as
 * `PriceCell`'s flash: the previous text is tracked in a ref committed after render, and
 * a landing survives re-renders that don't change the text, until it has finished.
 */
export function TickingText({ text, direction = 'up' }: { readonly text: string; readonly direction?: RollDirection }): ReactNode {
  const previousRef = useRef<{ readonly text: string; readonly since: number } | null>(null);
  const landingRef = useRef<TextLanding | null>(null);
  const previous = previousRef.current?.text ?? null;

  let landing: TextLanding | null = null;
  if (previous !== null && previous !== text && hasSettled(previousRef.current!.since)) {
    landing = { text, previous, at: performance.now() };
  } else if (landingRef.current?.text === text && isLanding(landingRef.current.at)) {
    landing = landingRef.current;
  }

  useEffect(() => {
    previousRef.current = { text, since: performance.now() };
    landingRef.current = landing;
  }, [text, landing]);

  return <RollingText text={text} previous={landing?.previous ?? null} direction={direction} />;
}
