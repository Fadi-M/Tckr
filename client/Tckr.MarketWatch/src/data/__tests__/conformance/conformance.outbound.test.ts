/**
 * Outbound frame conformance: subscribe/unsubscribe/ping match the contract's
 * byte-shape (client-contract.md §3.2), and — the FR-6 runtime check — no frame this
 * source ever sends contains a `stream`, `tier`, `userId` or `delay` field. Every frame
 * is produced via `serializeClientMessage` (task 01), which itself allowlists fields per
 * `type`; this test proves that allowlisting actually reaches the wire from this source,
 * not just that the function exists.
 */
import { describe, expect, it, vi } from 'vitest';
import { connectAndAuthenticate, createHarness } from './gatewayHarness.ts';

const FORBIDDEN_KEYS = ['stream', 'tier', 'userId', 'delay'] as const;

function parseFrames(sent: readonly string[]): readonly Record<string, unknown>[] {
  return sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
}

describe('gateway outbound frame conformance', () => {
  it('subscribe sends exactly {type, symbols, requestId}', async () => {
    const harness = createHarness();
    const socket = await connectAndAuthenticate(harness);
    harness.source.subscribe(['COMI', 'CIB']);
    expect(socket.sent).toHaveLength(1);
    const frame = JSON.parse(socket.sent[0] ?? '{}') as Record<string, unknown>;
    expect(Object.keys(frame).sort()).toEqual(['requestId', 'symbols', 'type']);
    expect(frame['type']).toBe('subscribe');
    expect(frame['symbols']).toEqual(['COMI', 'CIB']);
    expect(typeof frame['requestId']).toBe('string');
  });

  it('unsubscribe sends exactly {type, symbols, requestId}', async () => {
    const harness = createHarness();
    const socket = await connectAndAuthenticate(harness);
    harness.source.subscribe(['COMI']);
    harness.source.unsubscribe(['COMI']);
    const frame = JSON.parse(socket.sent[socket.sent.length - 1] ?? '{}') as Record<string, unknown>;
    expect(Object.keys(frame).sort()).toEqual(['requestId', 'symbols', 'type']);
    expect(frame['type']).toBe('unsubscribe');
    expect(frame['symbols']).toEqual(['COMI']);
  });

  it('ping (the liveness probe sent once per heartbeat interval) sends exactly {type, requestId}', async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      const socket = await connectAndAuthenticate(harness); // heartbeatIntervalMs = 15000
      const before = socket.sent.length;
      await vi.advanceTimersByTimeAsync(15000);
      const pingFrames = parseFrames(socket.sent.slice(before)).filter((f) => f['type'] === 'ping');
      expect(pingFrames.length).toBeGreaterThanOrEqual(1);
      const frame = pingFrames[0];
      expect(Object.keys(frame ?? {}).sort()).toEqual(['requestId', 'type']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('no frame ever sent by this source contains a stream, tier, userId or delay field', async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      const socket = await connectAndAuthenticate(harness);
      harness.source.subscribe(['COMI', 'CIB']);
      harness.source.unsubscribe(['CIB']);
      await vi.advanceTimersByTimeAsync(15000); // let a ping frame go out too

      expect(socket.sent.length).toBeGreaterThan(0);
      for (const frame of parseFrames(socket.sent)) {
        for (const forbidden of FORBIDDEN_KEYS) {
          expect(Object.keys(frame)).not.toContain(forbidden);
        }
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('subscribe/unsubscribe/ping are the only frame types ever sent', async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      const socket = await connectAndAuthenticate(harness);
      harness.source.subscribe(['COMI']);
      harness.source.unsubscribe(['COMI']);
      await vi.advanceTimersByTimeAsync(15000);

      const types = new Set(parseFrames(socket.sent).map((f) => f['type']));
      for (const type of types) {
        expect(['subscribe', 'unsubscribe', 'ping']).toContain(type);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
