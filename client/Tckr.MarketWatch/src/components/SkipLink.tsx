/**
 * A "skip to …" link: the first Tab stop on the page, visible only while focused, that
 * jumps keyboard focus past the chrome straight to a region's first control.
 *
 * It focuses the first element inside the target that is itself in the Tab order
 * (natively focusable, or `tabindex="0"` — a roving-tabindex list's current stop), and
 * the target itself only if it holds nothing focusable. A plain `href="#id"` would only
 * move the *starting point* for the next Tab, leaving the user one key press short and
 * on a non-interactive element.
 */
import type { MouseEvent, ReactNode } from 'react';

const TABBABLE =
  'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex="0"]';

export function SkipLink({ targetId, children }: { targetId: string; children: ReactNode }) {
  const skip = (event: MouseEvent<HTMLAnchorElement>): void => {
    const target = document.getElementById(targetId);
    if (!target) {
      return;
    }
    event.preventDefault();
    const first = target.querySelector<HTMLElement>(TABBABLE);
    if (first) {
      first.focus();
      return;
    }
    target.tabIndex = -1;
    target.focus();
  };

  return (
    <a
      href={`#${targetId}`}
      onClick={skip}
      className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-4 focus-visible:z-10 focus-visible:px-3.5! focus-visible:py-2! rounded-full border border-text bg-text text-surface font-sans text-caption font-semibold no-underline shadow-float outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
    >
      {children}
    </a>
  );
}
