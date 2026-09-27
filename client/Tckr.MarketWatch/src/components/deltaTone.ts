/**
 * The one colour recipe for every signed change on the page — the board's Change %
 * chip, the highlight cards' badge and the detail's change pills — so the same move
 * looks the same wherever it appears. A 20% tint of the signal colour behind the
 * AA-checked chip text (`--tckr-chip-text-*`: the plain up/down colours fall under
 * 4.5:1 on their own tint in light mode), and a neutral surface when there is no
 * direction. Only the colour lives here; each call site keeps the shape its context
 * needs (a tight chip in the dense board, a pill elsewhere). Colour never carries the
 * direction alone: every call site also prints a sign or an arrow.
 */
export type DeltaTone = 'up' | 'down' | 'flat';

export const DELTA_TONE_CLASSES: Record<DeltaTone, string> = {
  up: 'bg-[color-mix(in_oklab,var(--tckr-color-up)_20%,transparent)] text-chip-up',
  down: 'bg-[color-mix(in_oklab,var(--tckr-color-down)_20%,transparent)] text-chip-down',
  flat: 'bg-surface-raised',
};

/** The tone for a signed change, given as a number (a percentage) or a sign. */
export function deltaTone(sign: number): DeltaTone {
  return sign > 0 ? 'up' : sign < 0 ? 'down' : 'flat';
}
