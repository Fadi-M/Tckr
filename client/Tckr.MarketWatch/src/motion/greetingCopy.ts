/**
 * What the daily greeting says. Two lines, both true at the moment it plays: a
 * salutation for the time of day in Cairo (EGX's clock, which is the clock this board
 * keeps), and the market's state from the same calendar the board and the simulator
 * use. It never mentions the stream (LIVE/DELAYED): that is the server's to say, and at
 * first paint the server may not have said it yet.
 */
import { formatUntil } from '../display/formatUntil.ts';
import {
  cairoDateKey,
  formatCairoTimeShort,
  formatNextOpen,
  getCairoParts,
  isPreOpenAuction,
  type MarketStatus,
} from '../data/marketCalendar.ts';

export type GreetingTone = 'trading' | 'waiting' | 'closed';

export interface GreetingCopy {
  readonly salutation: string;
  readonly market: string;
  /** Which signal colour the market line's dot takes: green only while EGX trades. */
  readonly tone: GreetingTone;
}

export function greetingCopy(status: MarketStatus, nowMs: number): GreetingCopy {
  const hour = getCairoParts(nowMs).hour;
  const salutation =
    hour >= 5 && hour < 12
      ? 'Good morning'
      : hour >= 12 && hour < 17
        ? 'Good afternoon'
        : 'Good evening';

  if (status.state === 'open') {
    return {
      salutation,
      market: `EGX is trading · closes ${formatCairoTimeShort(status.sessionCloseAt)} Cairo`,
      tone: 'trading',
    };
  }
  if (isPreOpenAuction(status, nowMs)) {
    return {
      salutation,
      market: `Pre-open auction · trading starts ${formatCairoTimeShort(status.nextOpenAt)} Cairo`,
      tone: 'waiting',
    };
  }
  if (cairoDateKey(status.nextOpenAt) === cairoDateKey(nowMs)) {
    return {
      salutation,
      market: `EGX opens ${formatUntil(status.nextOpenAt - nowMs)}`,
      tone: 'closed',
    };
  }
  return {
    salutation,
    market: `EGX reopens ${formatNextOpen(status, nowMs)} Cairo`,
    tone: 'closed',
  };
}
