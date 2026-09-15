import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionState } from '../MarketDataSource.ts';
import { getSharedSource, resetSharedSource } from '../config.ts';
import { SimulatedSource } from '../SimulatedSource.ts';
import { resetStore } from '../store.ts';

describe('getSharedSource — one connection per client', () => {
  beforeEach(() => {
    resetStore();
    resetSharedSource();
  });

  afterEach(() => {
    resetSharedSource();
    vi.unstubAllEnvs();
  });

  it('returns the identical instance on repeated calls', () => {
    const a = getSharedSource();
    const b = getSharedSource();
    const c = getSharedSource();
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('calls connect() itself — callers do not need to', async () => {
    const source = getSharedSource();
    // Allow the fire-and-forget connect() promise to settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(source.identity()).not.toBeNull(); // populated only once connect() has run
  });

  it('resetSharedSource() disconnects the current instance and clears it', async () => {
    const source = getSharedSource();
    await Promise.resolve();
    await Promise.resolve();

    const statusEvents: ConnectionState[] = [];
    source.on.status((s) => statusEvents.push(s));

    resetSharedSource();

    expect(statusEvents.some((s) => s.kind === 'closed')).toBe(true);
  });

  it('yields a fresh instance after resetSharedSource()', () => {
    const first = getSharedSource();
    resetSharedSource();
    const second = getSharedSource();
    expect(second).not.toBe(first);
  });

  it('respects VITE_TCKR_SOURCE for the singleton, same as createMarketDataSource', () => {
    vi.stubEnv('VITE_TCKR_SOURCE', '');
    const simulated = getSharedSource();
    expect(simulated).toBeInstanceOf(SimulatedSource);

    resetSharedSource();

    vi.stubEnv('VITE_TCKR_SOURCE', 'gateway');
    const gateway = getSharedSource();
    expect(gateway).not.toBeInstanceOf(SimulatedSource);
  });

  it('a second getSharedSource() call in the same tick (StrictMode-style) does not create a second instance', () => {
    // Simulates React StrictMode's synchronous double-invocation of a mount effect.
    const a = getSharedSource();
    const b = getSharedSource();
    expect(a).toBe(b);
  });
});
