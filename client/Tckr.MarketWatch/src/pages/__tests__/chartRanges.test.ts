/**
 * `chartRanges.ts` — the detail chart's range windows end at the edge of the data:
 * "now" while EGX trades, the session's close once it has closed, and each range is
 * named for which of the two it is showing (a recap vs. a live window).
 */
import { describe, expect, it } from 'vitest';
import { cairoEpochFor, type MarketStatus } from '../../data/marketCalendar.ts';
import { describeRange, pointsInRange } from '../chartRanges.ts';

// Thu 24 Sep 2026 session: 10:00–14:30 Cairo.
const OPEN_AT = cairoEpochFor('2026-09-24', 10, 0);
const CLOSE_AT = cairoEpochFor('2026-09-24', 14, 30);

const OPEN: MarketStatus = {
  state: 'open',
  sessionDateKey: '2026-09-24',
  sessionOpenAt: OPEN_AT,
  sessionCloseAt: CLOSE_AT,
};
const CLOSED: MarketStatus = {
  state: 'closed',
  sessionDateKey: '2026-09-24',
  sessionOpenAt: OPEN_AT,
  sessionCloseAt: CLOSE_AT,
  nextOpenAt: cairoEpochFor('2026-09-27', 10, 0),
};

describe('describeRange while trading', () => {
  const now = cairoEpochFor('2026-09-24', 12, 0);

  it('trails the short ranges back from now, open-ended', () => {
    expect(describeRange('60S', OPEN, now)).toEqual({
      label: 'Last 60s',
      description: 'Last 60 seconds',
      from: now - 60_000,
      to: null,
    });
    expect(describeRange('5M', OPEN, now)).toMatchObject({
      label: 'Last 5m',
      from: now - 300_000,
      to: null,
    });
  });

  it('names SESSION as today since the open', () => {
    expect(describeRange('SESSION', OPEN, now)).toMatchObject({
      label: 'Today since 10:00',
      from: null,
      to: null,
    });
  });
});

describe('describeRange once closed', () => {
  // Saturday: the displayed session is Thursday's, long finished.
  const now = cairoEpochFor('2026-09-26', 20, 0);

  it('anchors the short ranges to the session close, not to now', () => {
    expect(describeRange('60S', CLOSED, now)).toEqual({
      label: 'Final 60s · Thu 24 Sep',
      description: 'Final 60 seconds of the Thu 24 Sep session, to the 14:30 close',
      from: CLOSE_AT - 60_000,
      to: CLOSE_AT,
    });
    expect(describeRange('5M', CLOSED, now)).toMatchObject({
      label: 'Final 5m · Thu 24 Sep',
      from: CLOSE_AT - 300_000,
      to: CLOSE_AT,
    });
  });

  it('names SESSION as a dated recap with its hours', () => {
    expect(describeRange('SESSION', CLOSED, now)).toMatchObject({
      label: 'Thu 24 Sep session · 10:00–14:30',
      description: 'The whole Thu 24 Sep session, 10:00 to 14:30 Cairo',
    });
  });
});

describe('pointsInRange', () => {
  const history = [0, 30, 60, 90, 120].map((s) => ({ t: CLOSE_AT - 120_000 + s * 1000 }));

  it('keeps the points inside a closed-market window', () => {
    const now = cairoEpochFor('2026-09-26', 20, 0);
    expect(pointsInRange(history, describeRange('60S', CLOSED, now)).map((p) => p.t)).toEqual([
      CLOSE_AT - 60_000,
      CLOSE_AT - 30_000,
      CLOSE_AT,
    ]);
  });

  it('returns the whole history unchanged for SESSION', () => {
    expect(pointsInRange(history, describeRange('SESSION', CLOSED, 0))).toBe(history);
  });
});
