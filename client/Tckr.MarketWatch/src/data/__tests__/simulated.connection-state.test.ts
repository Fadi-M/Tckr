/**
 * `SimulatedSource.connectionState()` — the synchronous "current status" a late
 * subscriber reads, because `getSharedSource()` connects before any component has
 * registered an `on.status` handler. It must always equal the last `on.status` event.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloseCode } from '../../contracts/closeCodes.ts';
import type { ConnectionState } from '../MarketDataSource.ts';
import { SimulatedSource } from '../SimulatedSource.ts';
import { resetStore } from '../store.ts';
import { baseConfig, KNOWN_OPEN_NOW_MS } from './testSupport.ts';

describe('SimulatedSource.connectionState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(KNOWN_OPEN_NOW_MS);
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports closed, not yet connected, before connect()', () => {
    const source = new SimulatedSource(baseConfig());
    expect(source.connectionState()).toEqual({
      kind: 'closed',
      code: CloseCode.Normal,
      reason: 'not connected yet',
    });
  });

  it('always agrees with the last on.status event through connect, drop and disconnect', async () => {
    const source = new SimulatedSource(baseConfig());
    let last: ConnectionState | undefined;
    source.on.status((s) => {
      last = s;
    });

    await source.connect();
    expect(source.connectionState().kind).toBe('connected');
    expect(source.connectionState()).toEqual(last);

    source.simulateDrop(CloseCode.SlowConsumer);
    expect(source.connectionState().kind).toBe('reconnecting');
    expect(source.connectionState()).toEqual(last);

    source.disconnect();
    expect(source.connectionState()).toEqual({
      kind: 'closed',
      code: CloseCode.Normal,
      reason: 'client disconnect',
    });
    expect(source.connectionState()).toEqual(last);
  });
});
