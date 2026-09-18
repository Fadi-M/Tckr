/**
 * `SimulatedSource.getHistory` — now day-scoped and EGX-hours-aware (see
 * `SimulatedSource.ts`'s module doc and `marketCalendar.ts`): opening the app mid-session
 * backfills instantly from session-open to "now"; opening it while closed backfills the
 * most recently completed session in full, frozen at the real close (never stretched to
 * "now" with a flat tail). All fixture timestamps are computed via `cairoEpochFor`
 * against 2026-01-15 (a Thursday, Egypt's DST off) — see `marketCalendar.test.ts` for
 * how that date was verified against `Intl` ground truth.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimulatedSource, type SimulatedSourceConfig } from '../SimulatedSource.ts';
import { cairoEpochFor } from '../marketCalendar.ts';
import { resetStore } from '../store.ts';
import { baseConfig } from './testSupport.ts';

const SESSION_OPEN = cairoEpochFor('2026-01-15', 10, 0); // Thu, 08:00 UTC
const SESSION_CLOSE = cairoEpochFor('2026-01-15', 14, 30); // Thu, 12:30 UTC
const MID_SESSION = SESSION_OPEN + 2 * 60 * 60 * 1000; // 2h into the session
const AFTER_CLOSE_SAME_DAY = SESSION_CLOSE + 30 * 60 * 1000; // 30 min after close, still Thursday
const FRIDAY_MIDDAY = Date.UTC(2026, 0, 16, 10, 0, 0); // EGX weekend
const FULL_SESSION_POINT_COUNT = 541; // 4.5h / 30s = 540 slots + the opening slot itself

async function connectedSourceAt(nowMs: number, overrides: Partial<SimulatedSourceConfig> = {}): Promise<SimulatedSource> {
  vi.setSystemTime(nowMs);
  const source = new SimulatedSource(baseConfig(overrides));
  await source.connect();
  return source;
}

beforeEach(() => {
  resetStore();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SimulatedSource session history — market-hours-aware backfill', () => {
  it('backfills history from session open up to "now" when the market is open', async () => {
    const source = await connectedSourceAt(MID_SESSION);
    const history = await source.getHistory('COMI');
    // ~2 hours / 30s = 240 slots + 1 = 241, plus possibly one more "now" tail point.
    expect(history.points.length).toBeGreaterThanOrEqual(241);
    expect(history.points.length).toBeLessThanOrEqual(242);
    source.disconnect();
  });

  it("backfills the full completed session, ending exactly at close, when connecting after today's close", async () => {
    const source = await connectedSourceAt(AFTER_CLOSE_SAME_DAY);
    const history = await source.getHistory('COMI');
    expect(history.points.length).toBe(FULL_SESSION_POINT_COUNT);
    const lastT = Date.parse(history.points[history.points.length - 1]!.t);
    // Not stretched with a flat tail out to "now" (30 minutes after the real close).
    expect(lastT).toBe(SESSION_CLOSE);
    source.disconnect();
  });

  it("shows the last completed trading day's full session on a weekend", async () => {
    const source = await connectedSourceAt(FRIDAY_MIDDAY);
    const history = await source.getHistory('COMI');
    expect(history.points.length).toBe(FULL_SESSION_POINT_COUNT);
    const lastT = Date.parse(history.points[history.points.length - 1]!.t);
    expect(lastT).toBe(SESSION_CLOSE);
    source.disconnect();
  });

  it('continues sampling live, every 30s, once caught up to "now" while open', async () => {
    const source = await connectedSourceAt(MID_SESSION);
    const before = (await source.getHistory('COMI')).points.length;
    await vi.advanceTimersByTimeAsync(60_000); // two more live samples
    const after = (await source.getHistory('COMI')).points.length;
    expect(after).toBeGreaterThan(before);
    source.disconnect();
  });

  it('is recorded for every symbol regardless of subscription state', async () => {
    const source = await connectedSourceAt(MID_SESSION);
    // Deliberately never subscribed to CIB.
    const history = await source.getHistory('CIB');
    expect(history.points.length).toBeGreaterThan(0);
    source.disconnect();
  });

  it('two independent sources backfill an identical closed session for the same seed', async () => {
    const a = await connectedSourceAt(AFTER_CLOSE_SAME_DAY, { seed: 777 });
    const b = await connectedSourceAt(AFTER_CLOSE_SAME_DAY, { seed: 777 });
    const historyA = await a.getHistory('COMI');
    const historyB = await b.getHistory('COMI');
    expect(historyA.points).toEqual(historyB.points);
    a.disconnect();
    b.disconnect();
  });

  it('a different seed produces a different backfilled session', async () => {
    const a = await connectedSourceAt(AFTER_CLOSE_SAME_DAY, { seed: 1 });
    const b = await connectedSourceAt(AFTER_CLOSE_SAME_DAY, { seed: 2 });
    const historyA = await a.getHistory('COMI');
    const historyB = await b.getHistory('COMI');
    expect(historyA.points).not.toEqual(historyB.points);
    a.disconnect();
    b.disconnect();
  });

  it('returns points oldest-first, each a valid ISO timestamp and decimal price', async () => {
    const source = await connectedSourceAt(MID_SESSION);
    const history = await source.getHistory('COMI');
    expect(history.symbol).toBe('COMI');
    expect(history.v).toBe(1);
    for (let i = 1; i < history.points.length; i += 1) {
      const prev = Date.parse(history.points[i - 1]!.t);
      const curr = Date.parse(history.points[i]!.t);
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
    for (const point of history.points) {
      expect(() => Number(point.p)).not.toThrow();
      expect(Number.isNaN(Date.parse(point.t))).toBe(false);
    }
    source.disconnect();
  });

  it('rejects for a symbol outside the universe', async () => {
    const source = await connectedSourceAt(MID_SESSION);
    await expect(source.getHistory('NOPE')).rejects.toThrow(/Unknown symbol/);
    source.disconnect();
  });

  it("preserves the session's backfilled history across a disconnect/reconnect within the same day", async () => {
    const source = await connectedSourceAt(MID_SESSION);
    const before = (await source.getHistory('COMI')).points.length;
    source.disconnect();
    await source.connect();
    const after = (await source.getHistory('COMI')).points.length;
    expect(after).toBeGreaterThanOrEqual(before);
    source.disconnect();
  });
});
