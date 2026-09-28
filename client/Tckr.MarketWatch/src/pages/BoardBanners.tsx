/**
 * The board's banner stack, split out of `StockList.tsx`: the delayed-stream note, the
 * connection banner (reconnecting / disconnected, with its manual retry through
 * `reconnectSharedSource()`), the market-closed banner and the one-shot moments (opening
 * bell, recovered stream). "The module doc" in comments below means `StockList.tsx`'s.
 */
import { useState, useEffect, useReducer, useCallback, useRef, type ReactNode } from 'react';
import { ClockIcon, RetryIcon, AlertIcon } from '../components/icons.tsx';
import { streamDelay } from '../components/streamDelay.ts';
import { useConnectionState } from '../components/useConnectionState.ts';
import { CloseCode } from '../contracts/closeCodes.ts';
import type { Stream } from '../contracts/messages.ts';
import { getSharedSource, reconnectSharedSource } from '../data/config.ts';
import {
  type MarketStatus,
  isPreOpenAuction,
  formatNextOpen,
  formatCairoTimeShort,
} from '../data/marketCalendar.ts';
import type { ConnectionState } from '../data/MarketDataSource.ts';
import { formatUntil } from '../display/formatUntil.ts';

// ---------------------------------------------------------------------------------
// Connection banner — independent observer of the shared MarketDataSource, mirroring
// (not sharing state with) ConnectionStatus (and the now-deleted StreamBadge). See
// module doc.
// ---------------------------------------------------------------------------------
/** Which stream the viewer is on, from the server's `identity()` only (never a
 * client-side default: `null` until the handshake). Re-read on every status transition
 * and entitlement change, the same two signals the header's StreamBadge follows. */
export function useViewerStream(): Stream | null {
  const [stream, setStream] = useState<Stream | null>(
    () => getSharedSource().identity()?.stream ?? null,
  );
  useEffect(() => {
    const source = getSharedSource();
    const refresh = (): void => setStream(source.identity()?.stream ?? null);
    const unsubStatus = source.on.status(refresh);
    const unsubEntitlement = source.on.entitlement(refresh);
    return () => {
      unsubStatus();
      unsubEntitlement();
    };
  }, []);
  return stream;
}
/** Shown while the viewer is on the DELAYED stream, above everything that carries a
 * price — the highlight cards, the board and the detail pane alike — so no price on
 * the page can be taken for a live one (the header badge alone was one small pill).
 * A lighter amber than the "stream dropped" warning: this is an entitlement, not a
 * fault (DESIGN.md, "The Tinted Status Rule": 9% tint, 24% border). */
export function DelayedStreamBanner() {
  const delay = streamDelay();
  return (
    <div
      className={`${CONN_BANNER_BASE} ${CONN_BANNER_DELAYED}`}
      role="note"
      data-testid="delayed-stream-banner"
    >
      <ClockIcon className="text-warning" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-small">Delayed prices · {delay.short} behind</div>
        {/* On a phone the title carries it: the header badge already says DELAYED, and
                the explanation would push the board a banner-height further down. */}
        <div className="mt-[3px] text-caption text-text-muted max-[640px]:sr-only">
          {delay.simulated
            ? `Every price on this page is ${delay.short} behind the exchange (simulated; a real delayed entitlement is 15\u00a0min).`
            : `Every price on this page is ${delay.short} behind the exchange, per your entitlement.`}
        </div>
      </div>
    </div>
  );
}
export function useConnectionBanner(): {
  state: ConnectionState;
  remainingSecs: number;
  heldSince: number | null;
} {
  const { state, eventReceivedAt, heldSince } = useConnectionState();
  const [, forceTick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (state.kind !== 'reconnecting') {
      return;
    }
    const id = setInterval(() => forceTick(), 1000);
    return () => clearInterval(id);
  }, [state.kind]);

  const remainingSecs =
    state.kind === 'reconnecting'
      ? Math.max(0, Math.ceil((state.nextRetryMs - (Date.now() - eventReceivedAt)) / 1000))
      : 0;

  return { state, remainingSecs, heldSince };
}
function closeDetail(code: CloseCode): string {
  switch (code) {
    case CloseCode.Normal:
      return 'The stream closed and will not retry on its own.';
    case CloseCode.Unauthenticated:
      return 'Not authenticated. Sign in again, then reconnect.';
    case CloseCode.TokenExpired:
      return 'Your session expired.';
    case CloseCode.HeartbeatTimeout:
      return 'The connection timed out.';
    case CloseCode.SlowConsumer:
      return 'This client fell behind and was disconnected. Try watching fewer symbols.';
  }
}
// Shared banner treatment — ConnectionBanner (warning/danger) and MarketClosedBanner
// (info) all render the same frosted-glass pill shape, animate in the same way, and
// share the same reduced-transparency/contrast-more opaque fallback (previously
// `.tckr-conn-banner` + a `--warning`/`--danger`/`--info` modifier). Each tone's
// background/border is a `color-mix` the design tokens don't expose as a plain
// utility, so it stays as an arbitrary value here rather than a new token.
export const CONN_BANNER_BASE =
  'flex items-center gap-3 px-4 py-3 rounded-full mb-3.5 backdrop-blur-tckr backdrop-saturate-150 animate-banner-in reduced-transparency:backdrop-blur-none reduced-transparency:backdrop-saturate-100 contrast-more:backdrop-blur-none contrast-more:backdrop-saturate-100';
const CONN_BANNER_WARNING =
  'bg-[color-mix(in_oklab,var(--tckr-color-warning)_16%,var(--tckr-glass-bg))] border border-[color-mix(in_oklab,var(--tckr-color-warning)_32%,transparent)] reduced-transparency:bg-[color-mix(in_oklab,var(--tckr-color-warning)_16%,var(--tckr-color-surface))] contrast-more:bg-[color-mix(in_oklab,var(--tckr-color-warning)_16%,var(--tckr-color-surface))]';
export const CONN_BANNER_DANGER =
  'bg-[color-mix(in_oklab,var(--tckr-color-down)_16%,var(--tckr-glass-bg))] border border-[color-mix(in_oklab,var(--tckr-color-down)_32%,transparent)] reduced-transparency:bg-[color-mix(in_oklab,var(--tckr-color-down)_16%,var(--tckr-color-surface))] contrast-more:bg-[color-mix(in_oklab,var(--tckr-color-down)_16%,var(--tckr-color-surface))]';
const CONN_BANNER_INFO =
  'bg-glass border border-glass-border reduced-transparency:bg-surface contrast-more:bg-surface';
const CONN_BANNER_DELAYED =
  'bg-[color-mix(in_oklab,var(--tckr-color-warning)_9%,var(--tckr-glass-bg))] border border-[color-mix(in_oklab,var(--tckr-color-warning)_24%,transparent)] reduced-transparency:bg-[color-mix(in_oklab,var(--tckr-color-warning)_9%,var(--tckr-color-surface))] contrast-more:bg-[color-mix(in_oklab,var(--tckr-color-warning)_9%,var(--tckr-color-surface))]';
const CONN_BANNER_GOOD =
  'bg-[color-mix(in_oklab,var(--tckr-color-up)_12%,var(--tckr-glass-bg))] border border-[color-mix(in_oklab,var(--tckr-color-up)_28%,transparent)] reduced-transparency:bg-[color-mix(in_oklab,var(--tckr-color-up)_12%,var(--tckr-color-surface))] contrast-more:bg-[color-mix(in_oklab,var(--tckr-color-up)_12%,var(--tckr-color-surface))]';
// 75px = the sticky app header (59px) + a 16px gap, the same offset the detail pane uses.
export const CONN_BANNER_STICKY = 'sticky top-[75px] z-[4]';
export const CONN_BANNER_STICKY_PHONE =
  'max-[800px]:sticky max-[800px]:top-[75px] max-[800px]:z-[4]';
const BANNER_DISMISS =
  'flex-none text-caption font-medium text-text-muted px-2.5 py-1.5 rounded-md cursor-pointer [transition:color_150ms_ease] fine-hover:text-text focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent focus-visible:outline-offset-2';
export const CONN_BANNER_ACTION =
  'font-semibold text-caption px-[13px] py-[7px] rounded-md border border-border bg-text text-surface cursor-pointer flex-none [transition:transform_120ms_ease-out,opacity_150ms_ease] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent focus-visible:outline-offset-2';
export function ConnectionBanner({
  state,
  remainingSecs,
  className = '',
}: {
  state: ConnectionState;
  remainingSecs: number;
  className?: string;
}) {
  if (state.kind === 'reconnecting') {
    return (
      <div className={`${CONN_BANNER_BASE} ${CONN_BANNER_WARNING} ${className}`} role="alert">
        <RetryIcon className="text-warning" />
        <div className="flex-1 min-w-0">
          {/* The countdown ticks every second inside this alert region; hiding it from
                    assistive tech keeps the alert to one announcement, not one per second. */}
          <div className="font-semibold text-small">
            The stream dropped<span aria-hidden="true"> — retrying in {remainingSecs}s</span>
            <span className="sr-only"> — retrying automatically</span>
          </div>
          <div className="mt-[3px] text-caption text-text-muted">
            Attempt {state.attempt}. Prices below are the last values received and are no longer
            moving.
          </div>
        </div>
        <button
          type="button"
          className={CONN_BANNER_ACTION}
          onClick={() => {
            reconnectSharedSource();
          }}
        >
          Retry now
        </button>
      </div>
    );
  }

  if (state.kind === 'closed') {
    return (
      <div className={`${CONN_BANNER_BASE} ${CONN_BANNER_DANGER} ${className}`} role="alert">
        <AlertIcon className="text-down" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-small">Disconnected</div>
          <div className="mt-[3px] text-caption text-text-muted">{closeDetail(state.code)}</div>
        </div>
        <button
          type="button"
          className={CONN_BANNER_ACTION}
          onClick={() => {
            reconnectSharedSource();
          }}
        >
          Reconnect
        </button>
      </div>
    );
  }

  return null;
}
// ---------------------------------------------------------------------------------
// Market-closed banner — an independent observer of `marketCalendar.getMarketStatus()`
// (via `useMarketStatus`), not the connection/transport (`ConnectionBanner` above).
// EGX being closed overnight/on the weekend/outside session hours is routine, expected
// state, distinct from a dropped WebSocket — the two must never be conflated into one
// banner, since a user restarting a healthy connection can't do anything about market
// hours, and vice versa.
// ---------------------------------------------------------------------------------
/**
 * True for `durationMs` after `trigger` is raised (see callers), plus a dismiss. Used
 * for the two moments this page marks once and then gets out of the way: the opening
 * bell and a recovered stream. Never on mount — only a change observed while mounted.
 */
function useMoment(durationMs: number): { shown: boolean; show: () => void; dismiss: () => void } {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!shown) {
      return;
    }
    const id = setTimeout(() => setShown(false), durationMs);
    return () => clearTimeout(id);
  }, [shown, durationMs]);
  return {
    shown,
    show: useCallback(() => setShown(true), []),
    dismiss: useCallback(() => setShown(false), []),
  };
}
/** The opening bell: shown once when EGX opens while this page is open. */
export function useOpeningBell(status: MarketStatus) {
  const moment = useMoment(8000);
  const previousState = useRef(status.state);
  const { show } = moment;
  useEffect(() => {
    if (previousState.current === 'closed' && status.state === 'open') {
      show();
    }
    previousState.current = status.state;
  }, [status.state, show]);
  return moment;
}
/** Shown briefly when the stream comes back after a drop, so recovery is confirmed
 * rather than inferred from a warning that silently disappeared. */
export function useRecoveryMoment(state: ConnectionState) {
  const moment = useMoment(4000);
  const interrupted = useRef(false);
  const { show } = moment;
  useEffect(() => {
    if (state.kind === 'reconnecting' || state.kind === 'closed') {
      interrupted.current = true;
    } else if (state.kind === 'connected' && interrupted.current) {
      interrupted.current = false;
      show();
    }
  }, [state.kind, show]);
  return moment;
}
export function MomentBanner({
  icon,
  title,
  detail,
  onDismiss,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  onDismiss: () => void;
}) {
  return (
    <div className={`${CONN_BANNER_BASE} ${CONN_BANNER_GOOD}`} role="status">
      <span className="flex-none text-up">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-small">{title}</div>
        <div className="mt-[3px] text-caption text-text-muted">{detail}</div>
      </div>
      <button type="button" className={BANNER_DISMISS} onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
/** `compact`: the split view's ~380px list column, where the full sentence wrapped to
 * three lines and pushed the board down. The chart beside it already says which session
 * it shows, so the column keeps only when trading resumes. */
export function MarketClosedBanner({
  status,
  className = '',
  compact = false,
}: {
  status: MarketStatus;
  className?: string;
  compact?: boolean;
}) {
  if (status.state !== 'closed') {
    return null;
  }
  // 09:30–10:00 Cairo is EGX's pre-open auction: orders are being collected but nothing
  // trades until the 10:00 open, so it gets its own wording rather than a flat "closed".
  const now = Date.now();
  const preOpen = isPreOpenAuction(status, now);
  // Re-rendered every 30s by `useMarketStatus`, so the countdown stays current to the
  // minute without a clock of its own.
  const until = formatUntil(status.nextOpenAt - now);
  return (
    <div className={`${CONN_BANNER_BASE} ${CONN_BANNER_INFO} ${className}`} role="status">
      <ClockIcon className="text-text-muted" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-small">
          {preOpen ? 'Pre-open auction' : 'Market closed'}
        </div>
        <div className="mt-[3px] text-caption text-text-muted">
          {/* The relative countdown is visual only: it changes every minute inside a
                status region, and the absolute Cairo time already says when. */}
          {compact ? (
            <>
              {preOpen ? 'Trading starts' : 'Reopens'} {formatNextOpen(status, now)} Cairo
            </>
          ) : preOpen ? (
            <>
              Continuous trading starts at {formatCairoTimeShort(status.nextOpenAt)} Cairo time
              <span aria-hidden="true">, {until}</span>. Prices below are from the last completed
              session.
            </>
          ) : (
            <>
              Showing the last completed session.Reopens {formatNextOpen(status, now)} Cairo time
              <span aria-hidden="true">, {until}</span>.
            </>
          )}
        </div>
      </div>
    </div>
  );
}
