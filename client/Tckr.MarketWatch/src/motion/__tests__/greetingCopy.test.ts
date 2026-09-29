/**
 * The greeting only says true things: a salutation for the viewer's own time of day, and
 * the market's state (in Cairo time) from the same calendar the board and simulator use. 2026-09-27 is a
 * Sunday (trading day); 2026-10-02 a Friday (EGX weekend).
 */
import { describe, expect, it } from 'vitest';
import { cairoEpochFor, getMarketStatus } from '../../data/marketCalendar.ts';
import { greetingCopy, salutationFor } from '../greetingCopy.ts';

const at = (day: string, hour: number, minute: number) => {
  const now = cairoEpochFor(day, hour, minute);
  return greetingCopy(getMarketStatus(now), now);
};

describe('greetingCopy', () => {
  it.each([
    [0, 'Hello, night owl'],
    [4, 'Hello, night owl'],
    [5, 'Hello, early bird'],
    [11, 'Hello, early bird'],
    [12, 'Hello, sunshine'],
    [16, 'Hello, sunshine'],
    [17, 'Hello, stargazer'],
    [20, 'Hello, stargazer'],
    [21, 'Hello, night owl'],
    [23, 'Hello, night owl'],
  ])('greets %i:00 with "%s"', (hour, salutation) => {
    expect(salutationFor(hour)).toBe(salutation);
  });

  it("greets by the viewer's own clock, not Cairo's", () => {
    const now = cairoEpochFor('2026-09-27', 11, 15);
    expect(greetingCopy(getMarketStatus(now), now).salutation).toBe(
      salutationFor(new Date(now).getHours()),
    );
  });

  it('says EGX is trading, and when it closes, during the session — the only green dot', () => {
    expect(at('2026-09-27', 11, 15)).toMatchObject({
      market: 'EGX is trading · closes 2:30 PM Cairo',
      tone: 'trading',
    });
  });

  it('names the pre-open auction', () => {
    expect(at('2026-09-27', 9, 40)).toMatchObject({
      market: 'Pre-open auction · trading starts 10:00 AM Cairo',
      tone: 'waiting',
    });
  });

  it('counts down to a same-day open the way the board banner does', () => {
    expect(at('2026-09-27', 8, 48)).toMatchObject({
      market: 'EGX opens in 1h 12m',
      tone: 'closed',
    });
  });

  it('names the next session after the close and over the weekend', () => {
    expect(at('2026-09-27', 16, 0).market).toBe('EGX reopens tomorrow 10:00 AM Cairo');
    expect(at('2026-10-02', 12, 0).market).toBe('EGX reopens Sun 10:00 AM Cairo');
  });
});
