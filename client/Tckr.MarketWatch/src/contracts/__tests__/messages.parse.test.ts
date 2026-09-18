import { describe, expect, it } from 'vitest';
import { parseServerMessage } from '../messages.ts';
import { FIXTURES, SERVER_MESSAGE_FIXTURE_NAMES } from '../fixtures/index.ts';

describe('parseServerMessage', () => {
  it.each(SERVER_MESSAGE_FIXTURE_NAMES)('parses fixture "%s" without throwing', (name) => {
    const raw = JSON.stringify(FIXTURES[name]);
    expect(() => parseServerMessage(raw)).not.toThrow();
  });

  it('round-trips the discriminant for every fixture', () => {
    for (const name of SERVER_MESSAGE_FIXTURE_NAMES) {
      const fixture = FIXTURES[name] as { type: string };
      const parsed = parseServerMessage(JSON.stringify(FIXTURES[name]));
      expect(parsed.type).toBe(fixture.type);
    }
  });

  it('throws on an unknown type', () => {
    expect(() => parseServerMessage(JSON.stringify({ v: 1, type: 'bogus' }))).toThrow();
  });

  it('throws on a non-object payload', () => {
    expect(() => parseServerMessage(JSON.stringify('just a string'))).toThrow();
    expect(() => parseServerMessage(JSON.stringify(42))).toThrow();
  });

  it('throws on a missing required field', () => {
    expect(() => parseServerMessage(JSON.stringify({ v: 1, type: 'heartbeat' }))).toThrow();
  });

  it('does not throw on an unknown field, and drops it', () => {
    const withExtra = { ...(FIXTURES['heartbeat'] as object), somethingNew: 'ignore me' };
    const raw = JSON.stringify(withExtra);
    let parsed: unknown;
    expect(() => {
      parsed = parseServerMessage(raw);
    }).not.toThrow();
    expect(parsed).not.toHaveProperty('somethingNew');
  });

  it('parses the price field of a tick fixture into a validated decimal string', () => {
    const parsed = parseServerMessage(JSON.stringify(FIXTURES['tick-trade']));
    if (parsed.type !== 'tick') throw new Error('expected a tick');
    expect(parsed.p).toBe('85.42');
  });

  it('parses nested snapshot price fields', () => {
    const parsed = parseServerMessage(JSON.stringify(FIXTURES['snapshot-live']));
    if (parsed.type !== 'snapshot') throw new Error('expected a snapshot');
    expect(parsed.snapshot.price).toBe('85.42');
    expect(parsed.snapshot.change).toBe('+1.05');
  });

  describe('connected.heartbeatIntervalMs bounds', () => {
    function connectedWith(heartbeatIntervalMs: unknown): string {
      return JSON.stringify({ ...(FIXTURES['connected-live'] as object), heartbeatIntervalMs });
    }

    it('accepts the fixture value unchanged (a normal, well-above-floor interval)', () => {
      const parsed = parseServerMessage(JSON.stringify(FIXTURES['connected-live']));
      if (parsed.type !== 'connected') throw new Error('expected a connected message');
      expect(parsed.heartbeatIntervalMs).toBe(15000);
    });

    it('throws on a zero heartbeatIntervalMs', () => {
      expect(() => parseServerMessage(connectedWith(0))).toThrow();
    });

    it('throws on a negative heartbeatIntervalMs', () => {
      expect(() => parseServerMessage(connectedWith(-500))).toThrow();
    });

    it('throws on a heartbeatIntervalMs below the 1000ms floor', () => {
      expect(() => parseServerMessage(connectedWith(1))).toThrow();
    });

    // NaN/Infinity cannot survive a JSON round trip (JSON.stringify emits `null` for
    // both), so they are already rejected by requireNumber's `typeof` check before
    // reaching the finite check below — covered by the "missing/wrong-type" cases
    // elsewhere in this file, not repeated here.

    it('accepts a heartbeatIntervalMs exactly at the floor', () => {
      const parsed = parseServerMessage(connectedWith(1000));
      if (parsed.type !== 'connected') throw new Error('expected a connected message');
      expect(parsed.heartbeatIntervalMs).toBe(1000);
    });
  });
});
