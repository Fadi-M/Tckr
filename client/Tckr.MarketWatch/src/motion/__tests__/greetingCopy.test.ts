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
  it('knows morning, afternoon, evening and night, at every boundary', () => {
    const expected: Record<number, string> = {};
    for (let hour = 0; hour < 24; hour++) {
      expected[hour] =
        hour >= 5 && hour < 12
          ? 'Good morning'
          : hour >= 12 && hour < 17
            ? 'Good afternoon'
            : hour >= 17 && hour < 21
              ? 'Good evening'
              : 'Good night';
    }
    for (let hour = 0; hour < 24; hour++) {
      expect(salutationFor(hour), `${hour}:00`).toBe(expected[hour]);
    }
    // The boundaries, spelled out.
    expect(salutationFor(4)).toBe('Good night');
    expect(salutationFor(5)).toBe('Good morning');
    expect(salutationFor(12)).toBe('Good afternoon');
    expect(salutationFor(17)).toBe('Good evening');
    expect(salutationFor(21)).toBe('Good night');
    expect(salutationFor(0)).toBe('Good night');
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
