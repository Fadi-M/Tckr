/**
 * Once per Cairo day, on the first load of that day, and never on a loop: if the
 * browser can't remember that it greeted, it doesn't greet at all.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cairoEpochFor } from '../../data/marketCalendar.ts';
import { markGreeted, shouldGreetToday } from '../greetingSchedule.ts';

const MORNING = cairoEpochFor('2026-09-27', 9, 0);
const LATER_SAME_DAY = cairoEpochFor('2026-09-27', 23, 30);
const NEXT_DAY = cairoEpochFor('2026-09-28', 0, 30);

afterEach(() => {
  window.localStorage.clear();
});

describe('greetingSchedule', () => {
  it('greets on the first load of a Cairo day, not again that day, and again the next', () => {
    expect(shouldGreetToday(MORNING, '', false)).toBe(true);
    markGreeted(MORNING);
    expect(shouldGreetToday(LATER_SAME_DAY, '', false)).toBe(false);
    expect(shouldGreetToday(NEXT_DAY, '', false)).toBe(true);
  });

  it('declines when storage is unavailable, rather than greeting on every load', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(shouldGreetToday(MORNING, '', false)).toBe(false);
  });

  it('replays on demand with ?greeting in development only', () => {
    markGreeted(MORNING);
    expect(shouldGreetToday(MORNING, '?greeting', true)).toBe(true);
    expect(shouldGreetToday(MORNING, '?greeting', false)).toBe(false);
  });
});
