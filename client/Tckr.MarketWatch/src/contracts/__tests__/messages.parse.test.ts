import { describe, expect, it } from 'vitest';
import { parseServerMessage } from '../messages.ts';
import { FIXTURES, SERVER_MESSAGE_FIXTURE_NAMES } from '../fixtures/index.ts';

describe('parseServerMessage', () => {
  it.each(SERVER_MESSAGE_FIXTURE_NAMES)('parses fixture "%s", keeping its type', (name) => {
    const fixture = FIXTURES[name] as { type: string };
    expect(parseServerMessage(JSON.stringify(fixture)).type).toBe(fixture.type);
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

    it.each([0, -500, 1, 999])('throws on %i, below the 1000 ms floor', (interval) => {
      expect(() => parseServerMessage(connectedWith(interval))).toThrow();
    });

    it.each([1000, 15000])('accepts %i', (interval) => {
      const parsed = parseServerMessage(connectedWith(interval));
      if (parsed.type !== 'connected') throw new Error('expected a connected message');
      expect(parsed.heartbeatIntervalMs).toBe(interval);
    });
  });
});
