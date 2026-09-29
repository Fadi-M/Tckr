import { describe, expect, it } from 'vitest';
import { serializeClientMessage, type ClientMessage } from '../messages.ts';

describe('ClientMessage has no stream/tier/delay/userId field (FR-6)', () => {
  it('rejects each field at compile time (checked by `npm run typecheck`)', () => {
    const bad: ClientMessage[] = [
      // @ts-expect-error ClientMessage must never carry a stream field (FR-6)
      { type: 'subscribe', symbols: ['COMI'], stream: 'LIVE' },
      // @ts-expect-error ClientMessage must never carry a tier field (FR-6)
      { type: 'ping', tier: 'gold' },
      // @ts-expect-error ClientMessage must never carry a delay field (FR-6)
      { type: 'unsubscribe', symbols: [], delay: 15000 },
      // @ts-expect-error ClientMessage must never carry a userId field (FR-6)
      { type: 'subscribe', symbols: [], userId: 'u1' },
    ];
    expect(bad).toHaveLength(4);
  });

  it('drops smuggled stream/tier/userId/delay keys at runtime even if the type system is bypassed', () => {
    const smuggled = {
      type: 'subscribe',
      symbols: ['COMI'],
      stream: 'LIVE',
      tier: 'gold',
      userId: 'user-001',
      delay: 900000,
    } as unknown as ClientMessage;

    const wire = JSON.parse(serializeClientMessage(smuggled)) as Record<string, unknown>;

    expect(wire).not.toHaveProperty('stream');
    expect(wire).not.toHaveProperty('tier');
    expect(wire).not.toHaveProperty('userId');
    expect(wire).not.toHaveProperty('delay');
    expect(wire['type']).toBe('subscribe');
    expect(wire['symbols']).toEqual(['COMI']);
  });

  it('serializes requestId only when present, never as null/undefined', () => {
    expect(JSON.parse(serializeClientMessage({ type: 'ping' }))).toEqual({ type: 'ping' });
    expect(JSON.parse(serializeClientMessage({ type: 'ping', requestId: 'r1' }))).toEqual({
      type: 'ping',
      requestId: 'r1',
    });
  });
});
