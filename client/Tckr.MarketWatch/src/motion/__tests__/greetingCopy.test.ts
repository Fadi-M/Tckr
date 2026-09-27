/**
 * The greeting only says true things: a salutation for the hour in Cairo, and the
 * market's state from the same calendar the board and simulator use. 2026-09-27 is a
 * Sunday (trading day); 2026-10-02 a Friday (EGX weekend).
 */
import { describe, expect, it } from 'vitest';
import { cairoEpochFor, getMarketStatus } from '../../data/marketCalendar.ts';
import { greetingCopy } from '../greetingCopy.ts';

const at = (day: string, hour: number, minute: number) => {
  const now = cairoEpochFor(day, hour, minute);
  return greetingCopy(getMarketStatus(now), now);
};

describe('greetingCopy', () => {
  it('greets by the hour in Cairo', () => {
    expect(at('2026-09-27', 8, 0).salutation).toBe('Good morning');
    expect(at('2026-09-27', 13, 0).salutation).toBe('Good afternoon');
    expect(at('2026-09-27', 19, 0).salutation).toBe('Good evening');
    expect(at('2026-09-27', 2, 0).salutation).toBe('Good evening');
  });

  it('says EGX is trading, and when it closes, during the session — the only green dot', () => {
    expect(at('2026-09-27', 11, 15)).toMatchObject({ market: 'EGX is trading · closes 14:30 Cairo', tone: 'trading' });
  });

  it('names the pre-open auction', () => {
    expect(at('2026-09-27', 9, 40)).toMatchObject({ market: 'Pre-open auction · trading starts 10:00 Cairo', tone: 'waiting' });
  });

  it('counts down to a same-day open the way the board banner does', () => {
    expect(at('2026-09-27', 8, 48)).toMatchObject({ market: 'EGX opens in 1h 12m', tone: 'closed' });
  });

  it('names the next session after the close and over the weekend', () => {
    expect(at('2026-09-27', 16, 0).market).toBe('EGX reopens tomorrow 10:00 Cairo');
    expect(at('2026-10-02', 12, 0).market).toBe('EGX reopens Sun 10:00 Cairo');
  });
});
