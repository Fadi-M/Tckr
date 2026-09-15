import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloseCode } from '../../contracts/closeCodes.ts';
import type { ConnectionState } from '../MarketDataSource.ts';
import { SimulatedSource } from '../SimulatedSource.ts';
import { resetStore } from '../store.ts';
import { baseConfig } from './testSupport.ts';

describe('SimulatedSource.connectionState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports a closed/not-yet-connected state before connect() is ever called', () => {
    const source = new SimulatedSource(baseConfig());
    expect(source.connectionState()).toEqual({
      kind: 'closed',
      code: CloseCode.Normal,
      reason: 'not connected yet',
    });
  });

  it('reflects "connected" once connect() has run', async () => {
    const source = new SimulatedSource(baseConfig());
    await source.connect();
    expect(source.connectionState().kind).toBe('connected');
    source.disconnect();
  });

  it('reflects "closed" after disconnect()', async () => {
    const source = new SimulatedSource(baseConfig());
    await source.connect();
    source.disconnect();
    expect(source.connectionState()).toEqual({
      kind: 'closed',
      code: CloseCode.Normal,
      reason: 'client disconnect',
    });
  });

  it("reflects a simulated drop's reconnecting transition", async () => {
    const source = new SimulatedSource(baseConfig());
    await source.connect();
    source.simulateDrop(CloseCode.HeartbeatTimeout);
    expect(source.connectionState().kind).toBe('reconnecting');
    source.disconnect();
  });

  it('always agrees with the most recent on.status event (no drift between the two)', async () => {
    const source = new SimulatedSource(baseConfig());
    let lastFromEvent: ConnectionState | undefined;
    source.on.status((s) => {
      lastFromEvent = s;
    });

    await source.connect();
    expect(source.connectionState()).toEqual(lastFromEvent);

    source.simulateDrop(CloseCode.SlowConsumer);
    expect(source.connectionState()).toEqual(lastFromEvent);

    source.disconnect();
    expect(source.connectionState()).toEqual(lastFromEvent);
  });

  it('is readable synchronously by a late subscriber that missed every on.status event', async () => {
    // This is the exact gap connectionState() exists to close: getSharedSource()
    // connects before any component has registered an on.status handler.
    const source = new SimulatedSource(baseConfig());
    await source.connect();
    // No on.status handler was ever registered above — connectionState() must still work.
    expect(source.connectionState().kind).toBe('connected');
    source.disconnect();
  });
});
