/**
 * Once per Cairo day. The first page load of each EGX calendar day (any URL) gets the
 * greeting; every other load goes straight to work. Remembered per browser in
 * `localStorage`, a per-viewer convenience: if storage is unavailable the greeting is
 * skipped rather than replayed on every load, because a greeting you can't escape
 * stops being one.
 *
 * `?greeting` in the URL replays it on demand in development, for working on it.
 */
import { cairoDateKey } from '../data/marketCalendar.ts';

const STORAGE_KEY = 'tckr.greeting.day';

export function shouldGreetToday(nowMs: number, search: string, dev: boolean): boolean {
  if (dev && new URLSearchParams(search).has('greeting')) {
    return true;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== cairoDateKey(nowMs);
  } catch {
    return false;
  }
}

/** Marks today as greeted. Called when the greeting starts, so a reload mid-greeting
 * doesn't play it again. */
export function markGreeted(nowMs: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, cairoDateKey(nowMs));
  } catch {
    // Nothing to remember it in; `shouldGreetToday` already declines in that case.
  }
}
