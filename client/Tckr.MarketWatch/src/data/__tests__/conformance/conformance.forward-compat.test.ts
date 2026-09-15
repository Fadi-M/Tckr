/**
 * Forward compatibility (client-contract.md header: "Additive optional fields are not
 * breaking — clients must ignore unknown fields rather than fail on them"): an unknown
 * field on a known message is ignored; an unknown `type` is logged and dropped, never
 * thrown into the UI or the socket.
 */
import { describe, expect, it, vi } from 'vitest';
import { FIXTURES } from '../../../contracts/fixtures/index.ts';
import type { Tick } from '../../../contracts/messages.ts';
import { connectAndAuthenticate, createHarness } from './gatewayHarness.ts';

describe('gateway forward-compatibility conformance', () => {
  it('a known message with an unrecognized extra field is still handled normally', async () => {
    const harness = createHarness();
    const socket = await connectAndAuthenticate(harness);
    const ticks: Tick[] = [];
    harness.source.on.tick((t) => ticks.push(t));

    socket.emit({ ...FIXTURES['tick-trade'], futureField: { nested: true } });

    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toMatchObject({ s: 'COMI', p: '85.42' });
    expect((ticks[0] as unknown as Record<string, unknown>)['futureField']).toBeUndefined();
  });

  it('an unrecognized message type is logged and dropped without throwing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const harness = createHarness();
    const socket = await connectAndAuthenticate(harness);
    const ticks: Tick[] = [];
    harness.source.on.tick((t) => ticks.push(t));

    expect(() => socket.emit({ v: 1, type: 'somethingFromTheFuture', payload: 'x' })).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();

    // The socket is still usable afterwards — a later, well-formed frame still works.
    socket.emit(FIXTURES['tick-trade']);
    expect(ticks).toHaveLength(1);
  });

  it('a malformed (non-JSON) frame is logged and dropped without throwing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const harness = createHarness();
    const socket = await connectAndAuthenticate(harness);

    expect(() => socket.emit('{not valid json')).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('a known type with a missing required field is logged and dropped, not thrown', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const harness = createHarness();
    const socket = await connectAndAuthenticate(harness);
    const ticks: Tick[] = [];
    harness.source.on.tick((t) => ticks.push(t));

    const { p: _omit, ...brokenTick } = FIXTURES['tick-trade'] as Record<string, unknown>;
    expect(() => socket.emit(brokenTick)).not.toThrow();
    expect(ticks).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
  });
});
