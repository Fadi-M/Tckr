/**
 * ConnectionStatus — task 07 (docs/phase-3-web-client/07-connection-lifecycle.md).
 *
 * Renders `ConnectionState` (task 02's seam) as one legible, actionable line. This
 * component is purely reactive: it never computes a backoff delay itself and never
 * calls `source.connect()` — `nextDelay`/`shouldReconnect` (`../data/reconnect.ts`) are
 * for whatever drives the retry loop against a real transport (task 08's
 * `TckrGatewaySource`) to call. All this component does is subscribe to
 * `source.on.status` and describe whatever state arrives, including a local
 * once-per-second countdown for `reconnecting` and elapsed time for `connected` (the
 * *display* ticks; the underlying `nextRetryMs`/`since` always come from the server).
 *
 * Mounted into `App`'s `statusSlot` (task 03) — see this task's report for the exact
 * `main.tsx` wiring lines.
 *
 * ---------------------------------------------------------------------------------
 * "Frosted Glass Revamp" restyle — one merged pill, same text
 * ---------------------------------------------------------------------------------
 * The whole pill's background/border/glow — not just the dot — changes colour with
 * the state. The entitlement stream (LIVE/DELAYED) is a separate concept with its own
 * pill, `StreamBadge`, mounted beside this one; this component only describes the
 * transport. When connected while EGX is not trading, the pill steps down to neutral
 * glass (see `CONNECTED_IDLE_CLASSES`) so it never glows green over a still market.
 *
 * The *text* deliberately does not change to the design's literal placeholder
 * labels ("LIVE"/"RECONNECTING"/"DISCONNECTED"): `describeState()`/`closeMessage()`
 * below give five *distinct, actionable* messages for `closed` (see
 * `status.close-codes.test.tsx`'s "4429 names the remedy") — collapsing all of them
 * to one generic "DISCONNECTED" label would throw away real, load-bearing product
 * information the design's own simplified 3-state placeholder never had to
 * represent. "LIVE" in particular belongs to `StreamBadge` (the entitlement stream), a
 * genuinely different concept from "the socket is up".
 *
 * No props: like `StreamBadge`, this component observes only the shared
 * `MarketDataSource` singleton (`getSharedSource()`, from task 02's `config.ts`) — never
 * a concrete source, never a client-side default for what it displays.
 *
 * ---------------------------------------------------------------------------------
 * Seeding the first render: `connectionState()`
 * ---------------------------------------------------------------------------------
 * `getSharedSource()` connects the singleton synchronously, inside the same call that
 * creates it (see config.ts's module doc). `SimulatedSource.connect()` itself emits
 * both `connecting` and `connected` synchronously, with no `await` in between. That
 * means by the time *any* caller — including this component — gets the source back
 * from `getSharedSource()`, those two events have already fired; subscribing to
 * `on.status` afterwards (necessarily, since subscribing needs the source reference)
 * can only ever observe transitions after that point. `MarketDataSource.connectionState`
 * (optional; both `SimulatedSource` and `TckrGatewaySource` implement it) is task 02's
 * answer to exactly this: a synchronous "what is it right now", read once at mount to
 * seed `useState`, then `on.status` takes over for every transition after that. Where
 * a source hasn't implemented it (declared optional so an older/partial implementation
 * still satisfies `MarketDataSource`), this component falls back to the same
 * `identity() !== null` proxy as before: non-null identity means `connected` already
 * happened (approximate `since` of "now" — the real timestamp is unrecoverable in that
 * case); null identity means `connecting`.
 *
 * One consequence worth noting for anyone adding a third source: after a *reconnectable*
 * close, `TckrGatewaySource` transitions to `reconnecting` synchronously in the same
 * call that emits `closed` (so a `connectionState()` read immediately after a drop
 * legitimately returns `reconnecting`, never a lingering `closed`). This component and
 * its tests treat that as normal — `closed` is a real, renderable state (e.g. `4401`,
 * which never reconnects) but is not guaranteed to be observable via `connectionState()`
 * for a code that recovers.
 */
import { useEffect, useState } from 'react';
import { getSharedSource } from '../data/config.ts';
import type { ConnectionState } from '../data/MarketDataSource.ts';
import { CloseCode } from '../contracts/closeCodes.ts';
import { isPreOpenAuction } from '../data/marketCalendar.ts';
import { useMarketStatus } from './useMarketStatus.ts';

function closeMessage(code: CloseCode): string {
  switch (code) {
    case CloseCode.Normal:
      return 'Disconnected';
    case CloseCode.Unauthenticated:
      return 'Not authenticated — sign in again';
    case CloseCode.TokenExpired:
      return 'Session expired — reconnecting';
    case CloseCode.HeartbeatTimeout:
      return 'Connection timed out — reconnecting';
    case CloseCode.SlowConsumer:
      return 'Disconnected: this client fell behind. Try watching fewer symbols.';
  }
}

/** Seconds remaining, never negative, rounded up so "1999ms left" still reads "2s"
 * rather than dropping straight to "1s". */
function remainingSeconds(ms: number): number {
  return Math.max(0, Math.ceil(ms / 1000));
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

function describeState(state: ConnectionState, remainingSecs: number, elapsedText: string): string {
  switch (state.kind) {
    case 'connecting':
      return 'Connecting…';
    case 'connected':
      return `Connected · ${elapsedText}`;
    case 'reconnecting':
      return `Reconnecting in ${remainingSecs}s (attempt ${state.attempt})`;
    case 'closed':
      return closeMessage(state.code);
  }
}

// `.tckr-connection-status`/`.tckr-status-dot` were styled by a `[data-state=...]`
// attribute selector in global.css. Tailwind utility classes can't attribute-select on
// the element's own data attribute, so the per-state colour/background/border/shadow
// are computed here instead, keyed off `state.kind`, and combined with the shared
// layout-only base classes below.
const PILL_STATE_CLASSES: Record<ConnectionState['kind'], string> = {
  connecting:
    'text-warning bg-[color-mix(in_oklab,var(--tckr-color-warning)_16%,var(--tckr-glass-bg))] border-[color-mix(in_oklab,var(--tckr-color-warning)_32%,transparent)]',
  reconnecting:
    'text-warning bg-[color-mix(in_oklab,var(--tckr-color-warning)_16%,var(--tckr-glass-bg))] border-[color-mix(in_oklab,var(--tckr-color-warning)_32%,transparent)]',
  connected:
    'text-up bg-[color-mix(in_oklab,var(--tckr-color-up)_16%,var(--tckr-glass-bg))] border-[color-mix(in_oklab,var(--tckr-color-up)_32%,transparent)] shadow-[0_4px_14px_color-mix(in_oklab,var(--tckr-color-up)_30%,transparent)]',
  closed:
    'text-down bg-[color-mix(in_oklab,var(--tckr-color-down)_16%,var(--tckr-glass-bg))] border-[color-mix(in_oklab,var(--tckr-color-down)_32%,transparent)]',
};

// Connected while EGX is not trading: the socket is healthy but there is nothing to
// stream, so the pill steps down to neutral glass — no green fill, no glow. A glowing
// "Connected" beside "Market closed" read as "prices are moving" and trained users to
// ignore the pill; the glow is now reserved for a connection that is carrying trades.
const CONNECTED_IDLE_CLASSES = 'text-text-muted bg-glass border-glass-border';
// ...and its dot too: a green dot is the same "trades are moving" signal in miniature.
const CONNECTED_IDLE_DOT_CLASS = 'bg-text-muted';

const DOT_STATE_CLASSES: Record<ConnectionState['kind'], string> = {
  connecting: 'bg-warning',
  reconnecting: 'bg-warning',
  connected: 'bg-up',
  closed: 'bg-down',
};

function seedState(): ConnectionState {
  const source = getSharedSource();
  const current = source.connectionState?.();
  if (current) {
    return current;
  }
  // Fallback for a `MarketDataSource` implementation that hasn't added
  // `connectionState()` — see the module doc.
  return source.identity() !== null ? { kind: 'connected', since: Date.now() } : { kind: 'connecting', attempt: 1 };
}

export function ConnectionStatus() {
  const [state, setState] = useState<ConnectionState>(seedState);
  const marketStatus = useMarketStatus();
  const [eventReceivedAt, setEventReceivedAt] = useState<number>(() => Date.now());
  // A ticking counter, incremented at most once per second while the displayed text is
  // time-dependent (`reconnecting`'s countdown, `connected`'s elapsed time). It exists
  // only to force a re-render on that cadence; the actual numbers are recomputed from
  // `Date.now()` each render, never accumulated.
  const [, setTick] = useState(0);

  useEffect(() => {
    const source = getSharedSource();
    return source.on.status((next) => {
      setEventReceivedAt(Date.now());
      setState(next);
    });
  }, []);

  useEffect(() => {
    if (state.kind !== 'reconnecting' && state.kind !== 'connected') {
      return;
    }
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [state.kind]);

  const remainingSecs = state.kind === 'reconnecting' ? remainingSeconds(state.nextRetryMs - (Date.now() - eventReceivedAt)) : 0;
  const elapsedText = state.kind === 'connected' ? formatElapsed(Date.now() - state.since) : '';

  const idle = state.kind === 'connected' && marketStatus.state !== 'open';
  const idleReason = isPreOpenAuction(marketStatus, Date.now())
    ? 'EGX is in its pre-open auction, so no trades are streaming yet'
    : 'EGX is closed, so no trades are streaming';

  return (
    <span
      className={`inline-flex items-center gap-2 font-mono text-label font-semibold tracking-[0.08em] px-[13px] py-[7px] rounded-full border whitespace-nowrap max-[640px]:px-2 max-[640px]:gap-1.5 max-[640px]:tracking-[0.03em] transition-[background-color,border-color,color,box-shadow] duration-[250ms] ease-out ${
        idle ? CONNECTED_IDLE_CLASSES : PILL_STATE_CLASSES[state.kind]
      }`}
      data-state={state.kind}
      data-idle={idle || undefined}
      role="status"
      title={idle ? `Connected to the feed. ${idleReason}.` : undefined}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full flex-none transition-[background-color] duration-[250ms] ${idle ? CONNECTED_IDLE_DOT_CLASS : DOT_STATE_CLASSES[state.kind]}`}
        data-state={state.kind}
        aria-hidden="true"
      />
      {/* This is a status region, so every text change is announced. The elapsed time
          and the retry countdown change every second: they are shown, but hidden from
          assistive tech, which hears only the state itself ("Connected", "Reconnecting,
          attempt 2"). */}
      {state.kind === 'connected' ? (
        // Same text as `describeState`, split so the elapsed time can drop on phones,
        // where the header has to fit the logo, stream badge, this pill and the theme
        // toggle on one row.
        <span data-testid="connection-status">
          Connected
          <span className="max-[640px]:hidden" aria-hidden="true">
            {' '}
            · {elapsedText}
          </span>
        </span>
      ) : state.kind === 'reconnecting' ? (
        <>
          <span data-testid="connection-status" aria-hidden="true">
            {describeState(state, remainingSecs, elapsedText)}
          </span>
          <span className="sr-only">Reconnecting, attempt {state.attempt}</span>
        </>
      ) : (
        <span data-testid="connection-status">{describeState(state, remainingSecs, elapsedText)}</span>
      )}
    </span>
  );
}
