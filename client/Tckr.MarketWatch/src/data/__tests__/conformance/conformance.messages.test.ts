/**
 * Layer 1 message conformance (08-gateway-source-conformance.md). For every recorded
 * server→client fixture, feeds it through `FakeWebSocket` into `TckrGatewaySource` and
 * asserts the documented interface-level effect.
 *
 * Coverage is derived, not hand-listed: `CASES` is typed `Record<MessageFixtureName,
 * ...>`, where `MessageFixtureName` is computed from `contracts/fixtures/index.ts`'s own
 * `FixtureName` (itself generated from `FIXTURES`, which task 01's own
 * `messages.coverage.test.ts` keeps paired 1:1 with `ServerMessage['type']`/`ErrorCode`).
 * A `Record<K, T>` object literal must have *exactly* the keys in `K` — TypeScript
 * rejects both a missing key and an excess one. So:
 *   - a fixture ADDED to `FIXTURES` without a case here → `MessageFixtureName` gains a
 *     member → this file fails to compile (missing key) → `npm run typecheck` fails.
 *   - a fixture REMOVED from `FIXTURES` → `MessageFixtureName` loses a member → this
 *     file fails to compile (excess key) → `npm run typecheck` fails.
 * Both outcomes were reproduced by hand while writing this file; see *Notes* in the
 * task 08 report for the exact typecheck output pasted from each.
 */
import { describe, expect, it, vi } from 'vitest';
import { FIXTURES, type FixtureName } from '../../../contracts/fixtures/index.ts';
import type { EntitlementChanged, ErrorMsg, Tick } from '../../../contracts/messages.ts';
import type { Snapshot } from '../../../contracts/rest.ts';
import type { ConnectionState } from '../../MarketDataSource.ts';
import { connectAndAuthenticate, createHarness } from './gatewayHarness.ts';

type MessageFixtureName = Exclude<FixtureName, 'symbols-universe'>;

describe('gateway message conformance', () => {
  const CASES: Record<MessageFixtureName, () => Promise<void>> = {
    'connected-live': async () => {
      const harness = createHarness();
      const statuses: ConnectionState[] = [];
      harness.source.on.status((s) => statuses.push(s));
      await connectAndAuthenticate(harness, FIXTURES['connected-live']);
      expect(harness.source.identity()).toEqual({ userId: 'user-001', stream: 'LIVE', sessionId: 'sess-live-0001' });
      expect(statuses.some((s) => s.kind === 'connected')).toBe(true);
    },

    'connected-delayed': async () => {
      const harness = createHarness();
      await connectAndAuthenticate(harness, FIXTURES['connected-delayed']);
      expect(harness.source.identity()).toEqual({
        userId: 'user-002',
        stream: 'DELAYED',
        sessionId: 'sess-delayed-0001',
      });
    },

    'subscribed-all-accepted': async () => {
      const harness = createHarness();
      const socket = await connectAndAuthenticate(harness);
      const errors: ErrorMsg[] = [];
      harness.source.on.error((e) => errors.push(e));
      harness.source.subscribe(['COMI', 'CIB']);
      socket.emit(FIXTURES['subscribed-all-accepted']);
      expect(errors).toHaveLength(0);
    },

    'subscribed-partial-reject': async () => {
      const harness = createHarness();
      const socket = await connectAndAuthenticate(harness);
      const errors: ErrorMsg[] = [];
      harness.source.on.error((e) => errors.push(e));
      harness.source.subscribe(['COMI', 'ZZZZ']);
      socket.emit(FIXTURES['subscribed-partial-reject']);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe('UNKNOWN_SYMBOL');
      expect(errors[0]?.requestId).toBe('r2');
    },

    unsubscribed: async () => {
      const harness = createHarness();
      const socket = await connectAndAuthenticate(harness);
      harness.source.subscribe(['CIB']);
      harness.source.unsubscribe(['CIB']);
      expect(() => socket.emit(FIXTURES['unsubscribed'])).not.toThrow();
    },

    'tick-trade': async () => {
      const harness = createHarness();
      const socket = await connectAndAuthenticate(harness);
      const ticks: Tick[] = [];
      harness.source.on.tick((t) => ticks.push(t));
      socket.emit(FIXTURES['tick-trade']);
      expect(ticks).toHaveLength(1);
      expect(ticks[0]).toMatchObject({ s: 'COMI', p: '85.42', k: 'TRADE', st: 'LIVE' });
    },

    'tick-bid': async () => {
      const harness = createHarness();
      const socket = await connectAndAuthenticate(harness);
      const ticks: Tick[] = [];
      harness.source.on.tick((t) => ticks.push(t));
      socket.emit(FIXTURES['tick-bid']);
      expect(ticks[0]?.k).toBe('BID');
    },

    'tick-ask': async () => {
      const harness = createHarness();
      const socket = await connectAndAuthenticate(harness);
      const ticks: Tick[] = [];
      harness.source.on.tick((t) => ticks.push(t));
      socket.emit(FIXTURES['tick-ask']);
      expect(ticks[0]?.k).toBe('ASK');
    },

    'tick-delayed': async () => {
      const harness = createHarness();
      const socket = await connectAndAuthenticate(harness);
      const ticks: Tick[] = [];
      harness.source.on.tick((t) => ticks.push(t));
      socket.emit(FIXTURES['tick-delayed']);
      expect(ticks[0]).toMatchObject({ s: 'CIB', st: 'DELAYED' });
    },

    'snapshot-live': async () => {
      const harness = createHarness();
      const socket = await connectAndAuthenticate(harness);
      const snapshots: Snapshot[] = [];
      harness.source.on.snapshot((s) => snapshots.push(s));
      socket.emit(FIXTURES['snapshot-live']);
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]).toMatchObject({ symbol: 'COMI', stream: 'LIVE', price: '85.42' });
    },

    'snapshot-delayed': async () => {
      const harness = createHarness();
      const socket = await connectAndAuthenticate(harness);
      const snapshots: Snapshot[] = [];
      harness.source.on.snapshot((s) => snapshots.push(s));
      socket.emit(FIXTURES['snapshot-delayed']);
      expect(snapshots[0]).toMatchObject({ symbol: 'CIB', stream: 'DELAYED' });
    },

    heartbeat: async () => {
      vi.useFakeTimers();
      try {
        const harness = createHarness();
        const statuses: ConnectionState[] = [];
        const socket = await connectAndAuthenticate(harness); // heartbeatIntervalMs = 15000
        harness.source.on.status((s) => statuses.push(s));
        // One interval with no heartbeat: one miss recorded, not yet a timeout.
        await vi.advanceTimersByTimeAsync(15000);
        // A heartbeat arrives and resets the miss counter...
        socket.emit(FIXTURES['heartbeat']);
        // ...so one more interval alone must not force a local 4408 close.
        await vi.advanceTimersByTimeAsync(15000);
        expect(statuses.some((s) => s.kind === 'closed')).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    },

    'error-unknown-symbol': async () => {
      const harness = createHarness();
      const socket = await connectAndAuthenticate(harness);
      const errors: ErrorMsg[] = [];
      harness.source.on.error((e) => errors.push(e));
      socket.emit(FIXTURES['error-unknown-symbol']);
      expect(errors[0]?.code).toBe('UNKNOWN_SYMBOL');
    },

    'error-subscription-limit': async () => {
      const harness = createHarness();
      const socket = await connectAndAuthenticate(harness);
      const errors: ErrorMsg[] = [];
      harness.source.on.error((e) => errors.push(e));
      socket.emit(FIXTURES['error-subscription-limit']);
      expect(errors[0]?.code).toBe('SUBSCRIPTION_LIMIT');
    },

    'error-not-entitled': async () => {
      const harness = createHarness();
      const socket = await connectAndAuthenticate(harness);
      const errors: ErrorMsg[] = [];
      harness.source.on.error((e) => errors.push(e));
      socket.emit(FIXTURES['error-not-entitled']);
      expect(errors[0]?.code).toBe('NOT_ENTITLED');
    },

    'error-rate-limited': async () => {
      const harness = createHarness();
      const socket = await connectAndAuthenticate(harness);
      const errors: ErrorMsg[] = [];
      harness.source.on.error((e) => errors.push(e));
      socket.emit(FIXTURES['error-rate-limited']);
      expect(errors[0]?.code).toBe('RATE_LIMITED');
    },

    'error-internal': async () => {
      const harness = createHarness();
      const socket = await connectAndAuthenticate(harness);
      const errors: ErrorMsg[] = [];
      harness.source.on.error((e) => errors.push(e));
      socket.emit(FIXTURES['error-internal']);
      expect(errors[0]?.code).toBe('INTERNAL');
    },

    'entitlement-upgraded': async () => {
      const harness = createHarness();
      const socket = await connectAndAuthenticate(harness, FIXTURES['connected-delayed']);
      const changes: EntitlementChanged[] = [];
      harness.source.on.entitlement((e) => changes.push(e));
      socket.emit(FIXTURES['entitlement-upgraded']);
      expect(changes[0]?.stream).toBe('LIVE');
      expect(harness.source.identity()?.stream).toBe('LIVE');
    },

    'entitlement-downgraded': async () => {
      const harness = createHarness();
      const socket = await connectAndAuthenticate(harness);
      const changes: EntitlementChanged[] = [];
      harness.source.on.entitlement((e) => changes.push(e));
      socket.emit(FIXTURES['entitlement-downgraded']);
      expect(changes[0]?.stream).toBe('DELAYED');
      expect(harness.source.identity()?.stream).toBe('DELAYED');
    },
  };

  it.each(Object.keys(CASES) as MessageFixtureName[])('%s produces its documented effect', async (name) => {
    const run = CASES[name];
    await run();
  });

  it('every ServerMessage type is represented by at least one fixture case', async () => {
    const { ALL_SERVER_MESSAGE_TYPES } = await import('../../../contracts/fixtures/index.ts');
    const typesWithCases = new Set(
      (Object.keys(CASES) as MessageFixtureName[]).map((name) => (FIXTURES[name] as { type: string }).type),
    );
    for (const type of ALL_SERVER_MESSAGE_TYPES) {
      expect(typesWithCases.has(type)).toBe(true);
    }
  });
});
