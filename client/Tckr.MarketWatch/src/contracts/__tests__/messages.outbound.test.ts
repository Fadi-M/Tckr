import { describe, expect, it } from 'vitest';
import { serializeClientMessage, type ClientMessage } from '../messages.ts';

describe('ClientMessage has no stream/tier/delay/userId field (FR-6)', () => {
  it('rejects a stream field at compile time', () => {
    // @ts-expect-error ClientMessage must never carry a stream field (FR-6)
    const bad: ClientMessage = { type: 'subscribe', symbols: ['COMI'], stream: 'LIVE' };
    expect(bad).toBeDefined();
  });

  it('rejects a tier field at compile time', () => {
    // @ts-expect-error ClientMessage must never carry a tier field (FR-6)
    const bad: ClientMessage = { type: 'ping', tier: 'gold' };
    expect(bad).toBeDefined();
  });

  it('rejects a delay field at compile time', () => {
    // @ts-expect-error ClientMessage must never carry a delay field (FR-6)
    const bad: ClientMessage = { type: 'unsubscribe', symbols: [], delay: 15000 };
    expect(bad).toBeDefined();
  });

  it('rejects a userId field at compile time', () => {
    // @ts-expect-error ClientMessage must never carry a userId field (FR-6)
    const bad: ClientMessage = { type: 'subscribe', symbols: [], userId: 'u1' };
    expect(bad).toBeDefined();
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

  it('omits requestId entirely when absent, rather than serializing null/undefined', () => {
    const wire = JSON.parse(serializeClientMessage({ type: 'ping' })) as Record<string, unknown>;
    expect(wire).not.toHaveProperty('requestId');
    expect(wire).toEqual({ type: 'ping' });
  });

  it('serializes requestId when present', () => {
    const wire = JSON.parse(
      serializeClientMessage({ type: 'ping', requestId: 'r1' }),
    ) as Record<string, unknown>;
    expect(wire['requestId']).toBe('r1');
  });
});
