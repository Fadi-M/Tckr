/**
 * Shared fake `MarketDataSource` for task 07's component tests. Not itself a
 * `*.test.ts(x)` file, so Vitest does not run it directly (mirrors
 * `src/data/__tests__/testSupport.ts`'s convention).
 *
 * Every test in this directory mocks `../../data/config.ts` (`getSharedSource` /
 * `resolveClientConfig`) rather than touching the real `SimulatedSource` — these
 * components must work against anything shaped like `MarketDataSource`, and a fake
 * keeps each test deterministic and fast under fake timers.
 */
import type { EntitlementChanged, ErrorMsg, Tick } from '../../contracts/messages.ts';
import type { Snapshot } from '../../contracts/rest.ts';
import type { ConnectionState, Identity, MarketDataSource } from '../../data/MarketDataSource.ts';

export interface FakeSource extends MarketDataSource {
  /** Test-only: pushes a `ConnectionState` to every registered `on.status` handler. */
  emitStatus(state: ConnectionState): void;
  /** Test-only: pushes an `EntitlementChanged` to every registered `on.entitlement`
   * handler. */
  emitEntitlement(event: EntitlementChanged): void;
  /** Test-only: changes what `identity()` returns, without emitting an event. */
  setIdentity(identity: Identity | null): void;
}

/**
 * `connectionState`: when omitted, the returned fake does not implement
 * `MarketDataSource.connectionState` at all (the property is absent, not merely
 * `undefined`-returning) — exercising `ConnectionStatus`'s fallback path for a source
 * that hasn't added it. Pass a value to exercise the seeded-from-`connectionState()`
 * path instead; that value is read once, at the moment `ConnectionStatus` seeds its
 * initial state (mount), matching how the real sources' synchronous getter is used.
 */
export function createFakeSource(
  initialIdentity: Identity | null = null,
  options: { connectionState?: ConnectionState } = {},
): FakeSource {
  const tickHandlers = new Set<(t: Tick) => void>();
  const snapshotHandlers = new Set<(s: Snapshot) => void>();
  const statusHandlers = new Set<(s: ConnectionState) => void>();
  const errorHandlers = new Set<(e: ErrorMsg) => void>();
  const entitlementHandlers = new Set<(e: EntitlementChanged) => void>();
  let identity = initialIdentity;
  const seededConnectionState = options.connectionState;

  const base: FakeSource = {
    connect: () => Promise.resolve(),
    disconnect: () => {},
    subscribe: () => {},
    unsubscribe: () => {},
    getUniverse: () => Promise.reject(new Error('FakeSource.getUniverse: not used in this test')),
    getSnapshot: () => Promise.reject(new Error('FakeSource.getSnapshot: not used in this test')),
    getHistory: () => Promise.reject(new Error('FakeSource.getHistory: not used in this test')),
    on: {
      tick: (h) => {
        tickHandlers.add(h);
        return () => tickHandlers.delete(h);
      },
      snapshot: (h) => {
        snapshotHandlers.add(h);
        return () => snapshotHandlers.delete(h);
      },
      status: (h) => {
        statusHandlers.add(h);
        return () => statusHandlers.delete(h);
      },
      error: (h) => {
        errorHandlers.add(h);
        return () => errorHandlers.delete(h);
      },
      entitlement: (h) => {
        entitlementHandlers.add(h);
        return () => entitlementHandlers.delete(h);
      },
    },
    identity: () => identity,
    emitStatus(state) {
      statusHandlers.forEach((h) => h(state));
    },
    emitEntitlement(event) {
      entitlementHandlers.forEach((h) => h(event));
    },
    setIdentity(next) {
      identity = next;
    },
  };

  return seededConnectionState !== undefined
    ? { ...base, connectionState: () => seededConnectionState }
    : base;
}

export function fakeIdentity(overrides: Partial<Identity> = {}): Identity {
  return { userId: 'user-001', stream: 'LIVE', sessionId: 'sim-session-1', ...overrides };
}
