/** `deltaTone.ts` — one colour recipe for every signed change (board chip, highlight
 * badge, detail pills), always on the AA-checked chip text colours. */
import { describe, expect, it } from 'vitest';
import { DELTA_TONE_CLASSES, deltaTone } from '../deltaTone.ts';

describe('deltaTone', () => {
  it('maps a sign to a tone', () => {
    expect(deltaTone(0.59)).toBe('up');
    expect(deltaTone(-0.16)).toBe('down');
    expect(deltaTone(0)).toBe('flat');
  });

  it('uses the AA chip text colours, never the plain signal colours, on a tint', () => {
    expect(DELTA_TONE_CLASSES.up).toContain('text-chip-up');
    expect(DELTA_TONE_CLASSES.down).toContain('text-chip-down');
    expect(`${DELTA_TONE_CLASSES.up} ${DELTA_TONE_CLASSES.down}`).not.toMatch(/\btext-(up|down)\b/);
  });
});
