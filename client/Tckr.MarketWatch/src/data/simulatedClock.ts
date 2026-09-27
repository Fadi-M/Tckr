/**
 * A development clock for the simulated source: lets `npm run dev:open`
 * (see `scripts/dev.mjs`) run the app as though it were EGX trading hours, whatever the
 * real time in Cairo is.
 *
 * It shifts the app's clock rather than forcing a market state, because "is EGX open"
 * is not one flag. The market status, `SimulatedSource`'s tick generator and its
 * session-so-far history, the 10-second display beat, chart timestamps and the opening
 * bell all read the wall clock (`marketCalendar.ts`'s module doc explains why that is a
 * pure function of time). Moving the clock once moves all of them together. Forcing
 * only the status would show an "open" badge over a simulator that emits nothing. From
 * the shifted start the clock runs forward in real time, so the market opens, trades and
 * closes on its own.
 *
 * Simulated source, development builds only: `resolveClientConfig` refuses the setting
 * alongside the real gateway (whose server timestamps a shifted client clock would
 * contradict) and in production builds.
 */
import { cairoDateKey, cairoEpochFor, getCairoParts, isTradingDay, previousTradingDateKey } from './marketCalendar.ts';

/** `open`: mid-session, with two hours of history behind it and two and a half ahead. */
const OPEN_AT = { hour: 12, minute: 0, second: 0 } as const;
/** `bell`: fifteen seconds before the 10:00 open, to watch the opening bell. */
const BELL_AT = { hour: 9, minute: 59, second: 45 } as const;

const TIME_PATTERN = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** The values `VITE_TCKR_SIM_CLOCK` (and `--market`) accept. */
export const SIMULATED_CLOCK_HELP = "'open' (12:00 Cairo), 'bell' (09:59:45 Cairo) or a Cairo time 'HH:MM[:SS]'";

function parseCairoTime(spec: string): { hour: number; minute: number; second: number } {
  if (spec === 'open') {
    return OPEN_AT;
  }
  if (spec === 'bell') {
    return BELL_AT;
  }
  const match = TIME_PATTERN.exec(spec);
  if (match) {
    const hour = +match[1]!;
    const minute = +match[2]!;
    const second = +(match[3] ?? '0');
    if (hour < 24 && minute < 60 && second < 60) {
      return { hour, minute, second };
    }
  }
  throw new Error(`Invalid simulated market clock "${spec}": expected ${SIMULATED_CLOCK_HELP}.`);
}

/**
 * The instant `spec` names: that Cairo time on the latest EGX trading day (today if
 * Cairo's today trades, else the one before), so the dates on screen stay plausible.
 */
export function resolveSimulatedClockTarget(spec: string, realNowMs: number): number {
  const time = parseCairoTime(spec.trim().toLowerCase());
  const today = cairoDateKey(realNowMs);
  const day = isTradingDay(getCairoParts(realNowMs).weekday) ? today : previousTradingDateKey(today);
  return cairoEpochFor(day, time.hour, time.minute) + time.second * 1000;
}

/**
 * Moves the page's clock so that it reads `targetMs` now, and runs on from there:
 * `Date.now()` and `new Date()` (no arguments) are shifted; a `Date` built from a given
 * time, `Date.parse` and `Date.UTC` are untouched. `performance.now()` is untouched too.
 * It measures durations, not the time of day. Call it before anything reads the clock.
 * Returns a function that puts the real clock back (for tests).
 */
export function installSimulatedClock(targetMs: number): () => void {
  const RealDate = Date;
  const offsetMs = targetMs - RealDate.now();
  const shiftedNow = (): number => RealDate.now() + offsetMs;

  function ShiftedDate(this: unknown, ...args: unknown[]): Date | string {
    if (!new.target) {
      // `Date()` called as a function returns the current time as a string.
      return new RealDate(shiftedNow()).toString();
    }
    return args.length === 0 ? new RealDate(shiftedNow()) : (Reflect.construct(RealDate, args, new.target) as Date);
  }
  ShiftedDate.prototype = RealDate.prototype;
  Object.setPrototypeOf(ShiftedDate, RealDate);
  (ShiftedDate as unknown as { now: () => number }).now = shiftedNow;

  globalThis.Date = ShiftedDate as unknown as DateConstructor;
  return () => {
    globalThis.Date = RealDate;
  };
}
