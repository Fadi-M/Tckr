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
 * The header used to render this component's plain text next to a separate
 * `StreamBadge` pill (task 07). The design import has one merged, colour-coded
 * status pill instead — `main.tsx` no longer wires `StreamBadge` into the header at
 * all (see its doc comment), and this component's own outer `<span>` now carries
 * `data-state` too (`global.css`'s `.tckr-connection-status[data-state=...]` rules),
 * so the whole pill's background/border/glow — not just the dot — changes colour
 * with the state.
 *
 * The *text* deliberately does not change to the design's literal placeholder
 * labels ("LIVE"/"RECONNECTING"/"DISCONNECTED"): `describeState()`/`closeMessage()`
 * below give five *distinct, actionable* messages for `closed` (see
 * `status.close-codes.test.tsx`'s "4429 names the remedy") — collapsing all of them
 * to one generic "DISCONNECTED" label would throw away real, load-bearing product
 * information the design's own simplified 3-state placeholder never had to
 * represent. It would also collide with `StreamBadge`'s own, unrelated use of the
 * word "LIVE" for the entitlement stream (a genuinely different concept — see that
 * file's doc) if both were ever visible together again later.
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

  return (
    <span className="tckr-connection-status" data-state={state.kind} role="status">
      <span className="tckr-status-dot" data-state={state.kind} aria-hidden="true" />
      <span data-testid="connection-status">{describeState(state, remainingSecs, elapsedText)}</span>
    </span>
  );
}
