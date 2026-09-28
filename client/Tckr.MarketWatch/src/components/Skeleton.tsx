/**
 * Skeleton — the shape of content that hasn't arrived yet, drawn where it will land and
 * at its size, so the page doesn't jump when the data comes in.
 *
 * A shape is a faint ink tint (7%) with a band of light sweeping across it: the glass
 * edges' own highlight (`--tckr-glass-border-card`, near-white on light glass, a soft
 * white on smoked glass), so it reads as light crossing the pane rather than a grey
 * slab. The sweep is a transformed pseudo-element, compositor-only. Under reduced motion
 * the shapes hold still.
 *
 * Skeletons only ever stand in for layout, never for data: no digits, no made-up line.
 * They are decorative (`aria-hidden`); whoever renders them also says "Loading" in text
 * for assistive technology.
 */
import type { CSSProperties } from 'react';

const SKELETON_CLASS =
  "relative block overflow-hidden rounded-[6px] bg-[color-mix(in_oklab,var(--tckr-color-text)_7%,transparent)] after:absolute after:inset-0 after:content-[''] after:bg-[linear-gradient(90deg,transparent,var(--tckr-glass-border-card),transparent)] after:animate-skeleton-sweep motion-reduce:after:hidden contrast-more:bg-[color-mix(in_oklab,var(--tckr-color-text)_14%,transparent)]";

export function Skeleton({
  className = '',
  style,
}: {
  readonly className?: string;
  readonly style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      data-skeleton
      className={`${SKELETON_CLASS} ${className}`}
      style={style}
    />
  );
}
