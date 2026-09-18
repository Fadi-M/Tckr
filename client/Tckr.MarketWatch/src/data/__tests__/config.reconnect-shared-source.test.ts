/**
 * `config.reconnect-shared-source.test.ts` — code-review fix (PR #3). `StockList.tsx`'s
 * `ConnectionBanner` "Retry now"/"Reconnect" buttons used to call
 * `getSharedSource().connect()` directly. Investigation for this fix found that a bare
 * `.connect()` is NOT safe to expose to call sites: `TckrGatewaySource.connect()` guards
 * only on `this.#socket`'s `readyState` (OPEN/CONNECTING); while `reconnecting`,
 * `#socket` is `undefined` (cleared by `#handleClose`), so a direct `.connect()` call
 * there slips past that guard *and* leaves `#reconnectTimer` armed — the timer later
 * fires and opens a second, independent socket. `config.ts` now exposes
 * `reconnectSharedSource()` instead: disconnect, then connect, so any pending automatic
 * reconnect timer is always cancelled first.
 *
 * `SimulatedSource` is what's actually wired up by default (`TckrGatewaySource` is
 * dormant until Phase 11 — out of scope for this fix), so this test exercises the real
 * `SimulatedSource`/`getSharedSource()` pairing under fake timers: a manual retry mid-
 * backoff must produce exactly one connect cycle, and the original automatic backoff
 * timer must never also fire afterwards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloseCode } from '../../contracts/closeCodes.ts';
import type { ConnectionState } from '../MarketDataSource.ts';
import { getSharedSource, reconnectSharedSource, resetSharedSource } from '../config.ts';
import { SimulatedSource } from '../SimulatedSource.ts';
import { resetStore } from '../store.ts';

describe('reconnectSharedSource — the one safe way a call site forces a fresh connect', () => {
  beforeEach(() => {
    resetStore();
    resetSharedSource();
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetSharedSource();
    vi.useRealTimers();
  });

  it('while reconnecting (mid-backoff), a manual retry produces exactly one connect cycle and cancels the pending automatic retry', () => {
    const source = getSharedSource();
    expect(source).toBeInstanceOf(SimulatedSource);
    expect(source.identity()).not.toBeNull(); // connect() runs synchronously on first access

    const events: ConnectionState[] = [];
    source.on.status((s) => events.push(s));

    // Drop with a recoverable code — arms SimulatedSource's own automatic backoff timer
    // (`simulateDrop` -> `dropReconnectTimer`).
    (source as SimulatedSource).simulateDrop(CloseCode.HeartbeatTimeout);
    expect(events.map((e) => e.kind)).toEqual(['closed', 'reconnecting']);
    const reconnecting = events[1];
    if (reconnecting?.kind !== 'reconnecting') {
      throw new Error('expected a reconnecting status event');
    }
    const pendingAutoDelay = reconnecting.nextRetryMs;

    events.length = 0;

    // Manual "Retry now" click, before the automatic backoff timer fires.
    reconnectSharedSource();

    // Exactly one connect cycle: the manual disconnect's `closed`, then the manual
    // connect's `connecting`/`connected` — never a duplicate, and never landing mid-
    // sequence (e.g. a stray extra `reconnecting`).
    expect(events.map((e) => e.kind)).toEqual(['closed', 'connecting', 'connected']);
    expect(source.identity()).not.toBeNull();

    events.length = 0;

    // Advance well past the ORIGINAL automatic backoff delay: `reconnectSharedSource()`'s
    // `disconnect()` must have cancelled that pending timer, so nothing fires here — no
    // second, redundant connect cycle racing the manual one.
    vi.advanceTimersByTime(pendingAutoDelay + 1000);
    expect(events).toEqual([]);
  });

  it('is a harmless disconnect+reconnect cycle when called while already connected', () => {
    const source = getSharedSource();
    expect(source.identity()).not.toBeNull();

    const events: ConnectionState[] = [];
    source.on.status((s) => events.push(s));

    reconnectSharedSource();

    expect(events.map((e) => e.kind)).toEqual(['closed', 'connecting', 'connected']);
    expect(source.identity()).not.toBeNull();
  });

  it('a rapid double-click only ever leaves one connect cycle in flight', () => {
    const source = getSharedSource();
    (source as SimulatedSource).simulateDrop(CloseCode.HeartbeatTimeout);

    const events: ConnectionState[] = [];
    source.on.status((s) => events.push(s));

    reconnectSharedSource();
    reconnectSharedSource();

    // Two full disconnect/connect cycles (one per click) — never more than that, and
    // the sequence stays a clean, well-formed alternation, never an overlapping/
    // duplicated status.
    expect(events.map((e) => e.kind)).toEqual(['closed', 'connecting', 'connected', 'closed', 'connecting', 'connected']);
    expect(source.identity()).not.toBeNull();
  });
});
