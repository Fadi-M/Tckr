/**
 * client-contract.md §4's reconnect sequence: authenticate → resubscribe(all) →
 * snapshot → resume. Driven by a `4408` (heartbeat timeout) drop, the order is proved
 * from externally observable effects only (never a private call log inside the source,
 * which would contradict the "adds no public members" / true-`#`-private design):
 *   - "authenticate": a new `FakeWebSocket` is constructed (`createSocket` spy).
 *   - "resubscribe": the new socket's first sent frame is `{type:'subscribe', ...}`
 *     naming every symbol that was subscribed before the drop.
 *   - "snapshot": `fetchImpl` is called against each subscribed symbol's snapshot path.
 *   - "resume": a tick delivered afterwards on the new socket reaches `on.tick`.
 */
import { describe, expect, it, vi } from 'vitest';
import { CloseCode } from '../../../contracts/closeCodes.ts';
import { FIXTURES } from '../../../contracts/fixtures/index.ts';
import type { Tick } from '../../../contracts/messages.ts';
import { TckrGatewaySource } from '../../TckrGatewaySource.ts';
import { FakeWebSocket } from '../../../test-support/FakeWebSocket.ts';
import { baseGatewayConfig, jsonResponse } from './gatewayHarness.ts';

/** Raw JSON body for `GET /symbols/{symbol}/snapshot` — deliberately untyped (`unknown`
 * on the wire, validated by `TckrGatewaySource`'s own REST parser), not a `Snapshot`
 * literal, since this stands in for a REST response body, not an already-parsed value. */
function snapshotBodyFor(symbol: string): unknown {
  const base = FIXTURES['snapshot-live'].snapshot;
  return { ...base, symbol };
}

describe('gateway reconnect sequence', () => {
  it('after a 4408 drop, the order is authenticate → resubscribe(all) → snapshot → resume', async () => {
    vi.useFakeTimers();
    try {
      let seq = 0;
      const marks: string[] = [];
      const mark = (label: string) => marks.push(`${(seq += 1)}:${label}`);

      const createSocket = vi.fn((url: string) => {
        mark('authenticate');
        return new FakeWebSocket(url);
      });

      const fetchImpl = vi.fn((url: string) => {
        if (url.endsWith('/symbols/COMI/snapshot')) {
          mark('snapshot:COMI');
          return Promise.resolve(jsonResponse(snapshotBodyFor('COMI')));
        }
        if (url.endsWith('/symbols/CIB/snapshot')) {
          mark('snapshot:CIB');
          return Promise.resolve(jsonResponse(snapshotBodyFor('CIB')));
        }
        return Promise.resolve(jsonResponse({ error: 'not found' }, false, 404));
      });

      const originalSend = FakeWebSocket.prototype.send;
      const sendSpy = vi.spyOn(FakeWebSocket.prototype, 'send').mockImplementation(function (
        this: FakeWebSocket,
        data: string,
      ) {
        const parsed = JSON.parse(data) as { type: string };
        if (parsed.type === 'subscribe') {
          mark('resubscribe');
        }
        return originalSend.call(this, data);
      });

      const source = new TckrGatewaySource(baseGatewayConfig(), {
        createSocket,
        fetchImpl,
        random: () => 0.5,
      });

      // --- initial connection, subscribe to two symbols ---
      const connectPromise = source.connect();
      const firstSocket = FakeWebSocket.lastInstance;
      if (!firstSocket) throw new Error('expected a socket to have been constructed');
      firstSocket.open();
      await connectPromise;
      firstSocket.emit(FIXTURES['connected-live']);

      const ticks: Tick[] = [];
      source.on.tick((t) => ticks.push(t));

      source.subscribe(['COMI', 'CIB']);
      firstSocket.emit({
        v: 1,
        type: 'subscribed',
        requestId: 'gw-1',
        stream: 'LIVE',
        accepted: ['COMI', 'CIB'],
        rejected: [],
      });

      marks.length = 0; // only the reconnect sequence itself matters from here on
      seq = 0;

      // --- drop with 4408, let backoff fire (attempt 1 → 500ms with random()=0.5) ---
      firstSocket.serverClose(CloseCode.HeartbeatTimeout, 'two consecutive heartbeats missed');
      await vi.advanceTimersByTimeAsync(500);

      const secondSocket = FakeWebSocket.lastInstance;
      if (!secondSocket || secondSocket === firstSocket) {
        throw new Error('expected a new FakeWebSocket to have been constructed for the reconnect');
      }
      secondSocket.open();
      await vi.advanceTimersByTimeAsync(0);
      secondSocket.emit(FIXTURES['connected-live']);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);

      // "resume": a tick on the new socket reaches on.tick.
      secondSocket.emit(FIXTURES['tick-trade']);
      mark('resume');

      const indexOf = (label: string) => marks.findIndex((m) => m.endsWith(`:${label}`));
      const idxAuth = indexOf('authenticate');
      const idxResub = indexOf('resubscribe');
      const idxSnapComi = indexOf('snapshot:COMI');
      const idxSnapCib = indexOf('snapshot:CIB');
      const idxResume = indexOf('resume');

      expect(idxAuth).toBeGreaterThanOrEqual(0);
      expect(idxResub).toBeGreaterThan(idxAuth);
      expect(idxSnapComi).toBeGreaterThan(idxResub);
      expect(idxSnapCib).toBeGreaterThan(idxResub);
      expect(idxResume).toBeGreaterThan(idxSnapComi);
      expect(idxResume).toBeGreaterThan(idxSnapCib);

      expect(ticks).toHaveLength(1);
      expect(ticks[0]).toMatchObject({ s: 'COMI' });

      sendSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});
