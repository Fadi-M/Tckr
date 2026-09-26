/**
 * How far behind the exchange the DELAYED stream runs, worded for display — the one
 * place that decides it, so `StreamBadge` (header) and `StockDetail` (as-of line and
 * delayed note) can never describe the same delay two different ways.
 *
 * A real gateway's DELAYED entitlement is 15 minutes behind (client-contract.md).
 * `SimulatedSource` fakes a much shorter offset (`VITE_TCKR_SIM_DELAY_MS`) so the demo
 * doesn't sit on a 15-minute-old tape; when that source is active the label must say
 * the real, shorter number and that it is simulated — never claim "15 min" for data
 * that is actually 15 seconds behind.
 */
import { resolveClientConfig } from '../data/config.ts';

export interface StreamDelay {
  /** Compact form for badges, e.g. `"15s"` or `"15 min"`. */
  readonly short: string;
  /** True when the offset is `SimulatedSource`'s stand-in, not a real entitlement. */
  readonly simulated: boolean;
}

export const REAL_DELAY_LABEL = '15 min';

export function formatOffset(ms: number): string {
  if (ms > 0 && ms % 60_000 === 0) {
    return `${ms / 60_000} min`;
  }
  if (ms > 0 && ms % 1000 === 0) {
    return `${ms / 1000}s`;
  }
  return `${ms}ms`;
}

export function streamDelay(): StreamDelay {
  const config = resolveClientConfig();
  if (config.source === 'simulated') {
    return { short: formatOffset(config.simulated.delayedOffsetMs), simulated: true };
  }
  return { short: REAL_DELAY_LABEL, simulated: false };
}
