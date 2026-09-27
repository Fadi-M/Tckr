/**
 * The "HELD" marker the board and the detail pane put beside frozen prices while the
 * stream is down (`useConnectionState`'s `isHeld`). It sits where the numbers are, so a
 * user scrolled past the connection banner still sees that nothing is moving.
 *
 * Amber at the fault strength of DESIGN.md's Tinted Status Rule (16% tint, 32% border),
 * the same tone as the "stream dropped" banner it echoes. Text, not only colour.
 */
export const HELD_TAG_CLASSES =
  'inline-flex items-center font-mono text-label font-semibold tracking-[0.14em] uppercase px-2 py-[3px] rounded-[5px] text-warning bg-[color-mix(in_oklab,var(--tckr-color-warning)_16%,transparent)] border border-[color-mix(in_oklab,var(--tckr-color-warning)_32%,transparent)]';

export function HeldTag({ testId }: { testId?: string }) {
  return (
    <span className={HELD_TAG_CLASSES} data-testid={testId}>
      Held
    </span>
  );
}
