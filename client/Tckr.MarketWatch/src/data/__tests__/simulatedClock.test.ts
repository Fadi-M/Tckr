/**
 * The development market clock (`npm run dev:open`, `dev:bell`, `dev -- --market HH:MM`). What must hold: each
 * value lands on the Cairo time it names, on the latest real EGX trading day (never a
 * Friday or Saturday, whose sessions don't exist); `open` really is an open market by
 * the same calendar the simulator trades on; and the installed clock shifts "now" only,
 * leaving every date built from a given time exactly as it was.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cairoEpochFor, getCairoParts, getMarketStatus } from '../marketCalendar.ts';
import { installSimulatedClock, resolveSimulatedClockTarget } from '../simulatedClock.ts';
import { resolveClientConfig } from '../config.ts';

// 2026-09-27 is a Sunday (a trading day); 2026-10-02 is a Friday (EGX weekend).
const SUNDAY_EVENING = cairoEpochFor('2026-09-27', 19, 40);
const FRIDAY_MORNING = cairoEpochFor('2026-10-02', 8, 5);

function cairoClock(epochMs: number): string {
  const p = getCairoParts(epochMs);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ${[p.hour, p.minute, p.second]
    .map((n) => String(n).padStart(2, '0'))
    .join(':')}`;
}

describe('resolveSimulatedClockTarget', () => {
  it("'open' is 12:00 Cairo today on a trading day, and the market is open then", () => {
    const target = resolveSimulatedClockTarget('open', SUNDAY_EVENING);
    expect(cairoClock(target)).toBe('2026-09-27 12:00:00');
    expect(getMarketStatus(target).state).toBe('open');
  });

  it("'bell' is 15 seconds before the 10:00 open, when the market is still closed", () => {
    const target = resolveSimulatedClockTarget('bell', SUNDAY_EVENING);
    expect(cairoClock(target)).toBe('2026-09-27 09:59:45');
    expect(getMarketStatus(target).state).toBe('closed');
    expect(getMarketStatus(target + 15_000).state).toBe('open');
  });

  it('takes any Cairo time, with or without seconds', () => {
    expect(cairoClock(resolveSimulatedClockTarget('14:29:30', SUNDAY_EVENING))).toBe('2026-09-27 14:29:30');
    expect(cairoClock(resolveSimulatedClockTarget('9:40', SUNDAY_EVENING))).toBe('2026-09-27 09:40:00');
  });

  it('uses the latest trading day on an EGX weekend (Friday → Thursday)', () => {
    expect(cairoClock(resolveSimulatedClockTarget('open', FRIDAY_MORNING))).toBe('2026-10-01 12:00:00');
  });

  it('rejects anything else with the accepted values in the message', () => {
    for (const bad of ['25:00', '12:60', '12:00:61', 'noon', '']) {
      expect(() => resolveSimulatedClockTarget(bad, SUNDAY_EVENING), bad).toThrow(/expected 'open'/);
    }
  });
});

describe('installSimulatedClock', () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
  });

  it('shifts now — Date.now(), new Date() and Date() — and nothing else', () => {
    const target = cairoEpochFor('2026-09-27', 12, 0);
    restore = installSimulatedClock(target);

    expect(Math.abs(Date.now() - target)).toBeLessThan(1000);
    expect(Math.abs(new Date().getTime() - target)).toBeLessThan(1000);
    // `Date()` called as a function: the shifted day, e.g. "Sun Sep 27 2026 …".
    expect(Date().slice(0, 15)).toBe(new Date(target).toString().slice(0, 15));
    // Dates from a given time, parsing and UTC construction are untouched.
    expect(new Date(0).getTime()).toBe(0);
    expect(new Date('2026-01-01T00:00:00Z').getTime()).toBe(Date.UTC(2026, 0, 1));
    expect(Date.parse('2026-01-01T00:00:00Z')).toBe(Date.UTC(2026, 0, 1));
    expect(new Date(2026, 0, 1).getFullYear()).toBe(2026);
    expect(new Date() instanceof Date).toBe(true);
    expect(new Date().toISOString()).toMatch(/^2026-09-27T/);
  });

  it('runs forward in real time from the shifted start', () => {
    vi.useFakeTimers();
    const target = cairoEpochFor('2026-09-27', 12, 0);
    restore = installSimulatedClock(target);
    const start = Date.now();
    vi.advanceTimersByTime(5_000);
    expect(Date.now() - start).toBe(5_000);
    vi.useRealTimers();
  });

  it('puts the real clock back when restored', () => {
    const RealDate = Date;
    installSimulatedClock(cairoEpochFor('2020-01-05', 12, 0))();
    expect(Date).toBe(RealDate);
  });
});

describe('resolveClientConfig — VITE_TCKR_SIM_CLOCK', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('passes the value through for the simulated source in development', () => {
    vi.stubEnv('VITE_TCKR_SIM_CLOCK', 'open');
    expect(resolveClientConfig().simulated.clock).toBe('open');
  });

  it('is unset (real time) by default', () => {
    vi.stubEnv('VITE_TCKR_SIM_CLOCK', '');
    expect(resolveClientConfig().simulated.clock).toBeUndefined();
  });

  it('refuses a malformed value at startup', () => {
    vi.stubEnv('VITE_TCKR_SIM_CLOCK', 'noon');
    expect(() => resolveClientConfig()).toThrow(/Invalid simulated market clock/);
  });

  it('refuses to shift the clock under the real gateway', () => {
    vi.stubEnv('VITE_TCKR_SOURCE', 'gateway');
    vi.stubEnv('VITE_TCKR_SIM_CLOCK', 'open');
    expect(() => resolveClientConfig()).toThrow(/only works with the simulated source/);
  });

  it('refuses in a production build, even with simulated data allowed', () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_TCKR_ALLOW_SIMULATED_IN_PROD', 'true');
    vi.stubEnv('VITE_TCKR_SIM_CLOCK', 'open');
    expect(() => resolveClientConfig()).toThrow(/development only/);
  });
});
