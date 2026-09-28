/**
 * The shared `MarketDataSource`'s connection state, plus when prices were last known to
 * be moving — an independent observer of `source.on.status`, like `ConnectionStatus`.
 *
 * "Held" is the user-facing name for `reconnecting`/`closed`: the stream has dropped, so
 * every price on screen is the last value received and is no longer moving. The board
 * and the detail pane both mark that state where the numbers are, not only in a banner
 * that may have scrolled away, and both say since when (`heldSince`).
 *
 * `heldSince` is the instant this hook saw the stream stop. If the hook mounts while the
 * stream is already held (the detail pane opened mid-outage), it seeds from mount time;
 * callers that know a more precise instant — the detail's own last tick — should prefer it.
 */
import { useEffect, useState } from 'react';
import { getSharedSource } from '../data/config.ts';
import type { ConnectionState } from '../data/MarketDataSource.ts';

export function isHeld(state: ConnectionState): boolean {
  return state.kind === 'reconnecting' || state.kind === 'closed';
}

export interface ConnectionView {
  readonly state: ConnectionState;
  /** `Date.now()` when the latest status event arrived (drives retry countdowns). */
  readonly eventReceivedAt: number;
  /** When the stream stopped, while it is held; `null` otherwise. */
  readonly heldSince: number | null;
}

function seedState(): ConnectionState {
  const source = getSharedSource();
  const current = source.connectionState?.();
  if (current) {
    return current;
  }
  // A source without `connectionState()` — see `ConnectionStatus`'s module doc.
  return source.identity() !== null
    ? { kind: 'connected', since: Date.now() }
    : { kind: 'connecting', attempt: 1 };
}

function seedView(): ConnectionView {
  const state = seedState();
  const now = Date.now();
  return { state, eventReceivedAt: now, heldSince: isHeld(state) ? now : null };
}

export function useConnectionState(): ConnectionView {
  const [view, setView] = useState<ConnectionView>(seedView);

  useEffect(() => {
    return getSharedSource().on.status((next) => {
      const now = Date.now();
      setView((previous) => ({
        state: next,
        eventReceivedAt: now,
        // A retry that fails again keeps the original instant: the prices have been
        // held since the first drop, not since the latest attempt.
        heldSince: isHeld(next) ? (previous.heldSince ?? now) : null,
      }));
    });
  }, []);

  return view;
}
