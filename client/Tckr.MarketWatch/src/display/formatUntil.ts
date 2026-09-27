/**
 * How long until something, the way a person says it: shared by the board's
 * market-closed banner and the daily greeting, so the two never word the same wait
 * differently.
 */

/** "in 1d 14h", "in 3h 12m", "in 12m", "in under a minute" — coarse on purpose: this
 * is a wait, not a timer, and a seconds countdown would only add noise. */
export function formatUntil(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) {
    return 'in under a minute';
  }
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) {
    return `in ${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `in ${hours}h ${mins}m`;
  }
  return `in ${mins}m`;
}
