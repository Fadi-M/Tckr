/**
 * What the daily greeting says. Two lines, both true at the moment it plays: a
 * salutation for the viewer's own time of day (it greets the person, wherever they are),
 * and the market's state in Cairo time (EGX's clock, which is the clock this board keeps)
 * from the same calendar the board and the simulator use. It never mentions the stream (LIVE/DELAYED): that is the server's to say, and at
 * first paint the server may not have said it yet.
 */
import { formatUntil } from '../display/formatUntil.ts';
import {
  cairoDateKey,
  formatCairoTimeShort,
  formatNextOpen,
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

/** The salutation for a local clock hour (0–23), one familiar "Hello, …" for each part
 * of the day: morning 5 AM–noon, afternoon noon–5 PM, evening 5–9 PM, night 9 PM–5 AM. */
export function salutationFor(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Hello, early bird';
  if (hour >= 12 && hour < 17) return 'Hello, sunshine';
  if (hour >= 17 && hour < 21) return 'Hello, stargazer';
  return 'Hello, night owl';
}

export function greetingCopy(status: MarketStatus, nowMs: number): GreetingCopy {
  // The viewer's local hour. Under the development clock (`simulatedClock.ts`) `Date` is
  // shifted too, so `npm run dev:open` greets for the simulated time of day.
  const salutation = salutationFor(new Date(nowMs).getHours());

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
