/**
 * All fixture timestamps below were verified against `Intl.DateTimeFormat` ground truth
 * (not hand-computed) before being hardcoded — see the session that added this file.
 * 2026-01-15 is a Thursday with Egypt's DST off (UTC+2); 2026-08-13 is a Thursday with
 * Egypt's DST on (UTC+3, Law No. 34/2023's last-Friday-of-April–last-Thursday-of-October
 * window) — together they prove the `Intl`-based conversion adapts to DST with no
 * special-casing in this module. 2026-01-16/17 are Friday/Saturday (EGX weekend);
 * 2026-01-18 is the following Sunday (EGX week resumes).
 */
import { describe, expect, it } from 'vitest';
import {
  cairoDateKey,
  cairoEpochFor,
  formatCairoClock,
  formatCairoTimeShort,
  formatNextOpen,
  getCairoParts,
  getMarketStatus,
  isTradingDay,
  nextTradingDateKey,
  previousTradingDateKey,
} from '../marketCalendar.ts';

describe('getCairoParts / cairoDateKey', () => {
  it('resolves DST-off (winter) Cairo time as UTC+2', () => {
    const parts = getCairoParts(Date.UTC(2026, 0, 15, 10, 0, 0)); // 10:00 UTC
    expect(parts).toMatchObject({ year: 2026, month: 1, day: 15, weekday: 4, hour: 12, minute: 0 });
  });

  it('resolves DST-on (summer) Cairo time as UTC+3', () => {
    const parts = getCairoParts(Date.UTC(2026, 7, 13, 10, 0, 0)); // 10:00 UTC
    expect(parts).toMatchObject({ year: 2026, month: 8, day: 13, weekday: 4, hour: 13, minute: 0 });
  });

  it('cairoDateKey formats as zero-padded YYYY-MM-DD', () => {
    expect(cairoDateKey(Date.UTC(2026, 0, 15, 10, 0, 0))).toBe('2026-01-15');
  });
});

describe('cairoEpochFor', () => {
  it('round-trips a winter (DST-off) Cairo wall time to the correct UTC instant', () => {
    // Cairo 10:00 in winter (UTC+2) is 08:00 UTC.
    expect(cairoEpochFor('2026-01-15', 10, 0)).toBe(Date.UTC(2026, 0, 15, 8, 0, 0));
  });

  it('round-trips a summer (DST-on) Cairo wall time to the correct UTC instant', () => {
    // Cairo 10:00 in summer (UTC+3) is 07:00 UTC.
    expect(cairoEpochFor('2026-08-13', 10, 0)).toBe(Date.UTC(2026, 7, 13, 7, 0, 0));
  });

  it('is the inverse of getCairoParts/cairoDateKey for an arbitrary wall time', () => {
    const epoch = cairoEpochFor('2026-01-15', 14, 30);
    const parts = getCairoParts(epoch);
    expect(parts).toMatchObject({ year: 2026, month: 1, day: 15, hour: 14, minute: 30 });
  });
});

describe('isTradingDay', () => {
  it('is true Sunday(0) through Thursday(4)', () => {
    for (let weekday = 0; weekday <= 4; weekday += 1) {
      expect(isTradingDay(weekday)).toBe(true);
    }
  });

  it('is false for Friday(5) and Saturday(6)', () => {
    expect(isTradingDay(5)).toBe(false);
    expect(isTradingDay(6)).toBe(false);
  });
});

describe('previousTradingDateKey / nextTradingDateKey', () => {
  it('steps back over the Friday/Saturday weekend', () => {
    // 2026-01-18 is a Sunday; the previous trading day is Thursday 2026-01-15.
    expect(previousTradingDateKey('2026-01-18')).toBe('2026-01-15');
  });

  it('steps forward over the Friday/Saturday weekend', () => {
    // 2026-01-15 is a Thursday; the next trading day is Sunday 2026-01-18.
    expect(nextTradingDateKey('2026-01-15')).toBe('2026-01-18');
  });

  it('steps to the adjacent day when no weekend is in the way', () => {
    expect(previousTradingDateKey('2026-01-15')).toBe('2026-01-14'); // Thu -> Wed
    expect(nextTradingDateKey('2026-01-14')).toBe('2026-01-15'); // Wed -> Thu
  });
});

describe('getMarketStatus', () => {
  it('is open during a Thursday mid-session (winter, DST off)', () => {
    const status = getMarketStatus(Date.UTC(2026, 0, 15, 10, 0, 0)); // 12:00 Cairo
    expect(status.state).toBe('open');
    expect(status.sessionDateKey).toBe('2026-01-15');
  });

  it('is open during a Thursday mid-session (summer, DST on)', () => {
    const status = getMarketStatus(Date.UTC(2026, 7, 13, 9, 0, 0)); // 12:00 Cairo
    expect(status.state).toBe('open');
    expect(status.sessionDateKey).toBe('2026-08-13');
  });

  it('is open at the exact opening instant (boundary inclusive)', () => {
    const openAt = cairoEpochFor('2026-01-15', 10, 0);
    expect(getMarketStatus(openAt).state).toBe('open');
  });

  it('is closed at the exact closing instant (boundary exclusive)', () => {
    const closeAt = cairoEpochFor('2026-01-15', 14, 30);
    const status = getMarketStatus(closeAt);
    expect(status.state).toBe('closed');
    if (status.state === 'closed') {
      expect(status.sessionDateKey).toBe('2026-01-15'); // today's own session just completed
    }
  });

  it('is closed before today\'s open on a trading day, showing the previous session', () => {
    const status = getMarketStatus(Date.UTC(2026, 0, 15, 6, 0, 0)); // 08:00 Cairo, before 10:00
    expect(status.state).toBe('closed');
    if (status.state === 'closed') {
      expect(status.sessionDateKey).toBe('2026-01-14'); // previous trading day (Wed)
      expect(status.nextOpenAt).toBe(cairoEpochFor('2026-01-15', 10, 0));
    }
  });

  it('is closed after today\'s close on a trading day, showing today\'s now-complete session', () => {
    const status = getMarketStatus(Date.UTC(2026, 0, 15, 13, 0, 0)); // 15:00 Cairo, after 14:30
    expect(status.state).toBe('closed');
    if (status.state === 'closed') {
      expect(status.sessionDateKey).toBe('2026-01-15');
      expect(status.nextOpenAt).toBe(cairoEpochFor('2026-01-18', 10, 0)); // next trading day: Sunday
    }
  });

  it('is closed on the Friday/Saturday weekend, showing the last completed session', () => {
    const friday = getMarketStatus(Date.UTC(2026, 0, 16, 10, 0, 0));
    expect(friday.state).toBe('closed');
    if (friday.state === 'closed') {
      expect(friday.sessionDateKey).toBe('2026-01-15'); // last Thursday
      expect(friday.nextOpenAt).toBe(cairoEpochFor('2026-01-18', 10, 0));
    }

    const saturday = getMarketStatus(Date.UTC(2026, 0, 17, 10, 0, 0));
    expect(saturday.state).toBe('closed');
    if (saturday.state === 'closed') {
      expect(saturday.sessionDateKey).toBe('2026-01-15');
    }
  });
});

describe('formatCairoClock / formatCairoTimeShort', () => {
  it('formats HH:MM:SS in Cairo time', () => {
    expect(formatCairoClock(Date.UTC(2026, 0, 15, 10, 5, 3))).toBe('12:05:03');
  });

  it('formats HH:MM (no seconds) in Cairo time', () => {
    expect(formatCairoTimeShort(Date.UTC(2026, 0, 15, 10, 5, 3))).toBe('12:05');
  });

  it('agrees with getMarketStatus\'s own Cairo-time boundaries', () => {
    const openAt = cairoEpochFor('2026-08-13', 10, 0);
    expect(formatCairoTimeShort(openAt)).toBe('10:00');
  });
});

describe('formatNextOpen', () => {
  it('composes "{Weekday} {HH:MM}" (no "Cairo" suffix) for a closed status\'s nextOpenAt', () => {
    // 2026-01-15 (Thursday) before open: closed, reopens later the same day at 10:00.
    const status = getMarketStatus(Date.UTC(2026, 0, 15, 6, 0, 0)); // 08:00 Cairo, before 10:00
    expect(status.state).toBe('closed');
    if (status.state === 'closed') {
      expect(formatNextOpen(status)).toBe('Thu 10:00');
    }
  });

  it('reflects the weekend-skipping nextOpenAt (reopens Sunday)', () => {
    // Friday: closed, reopens the following Sunday at 10:00.
    const status = getMarketStatus(Date.UTC(2026, 0, 16, 10, 0, 0));
    expect(status.state).toBe('closed');
    if (status.state === 'closed') {
      expect(formatNextOpen(status)).toBe('Sun 10:00');
    }
  });
});
