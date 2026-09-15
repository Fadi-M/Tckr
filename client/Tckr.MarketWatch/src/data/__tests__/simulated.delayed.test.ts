import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tick } from '../../contracts/messages.ts';
import { resetStore } from '../store.ts';
import { SimulatedSource } from '../SimulatedSource.ts';
import { baseConfig } from './testSupport.ts';

describe('SimulatedSource DELAYED buffering', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds a tick for at least delayedOffsetMs before delivering it, with t unchanged', async () => {
    const delayedOffsetMs = 15000;
    const source = new SimulatedSource(baseConfig({ demoUser: 'user-002', delayedOffsetMs }));
    expect(source.identity()).toBeNull();

    const universe = await source.getUniverse();
    source.subscribe(universe.symbols.map((s) => s.symbol));
    await source.connect();

    expect(source.identity()?.stream).toBe('DELAYED');

    const received: { tick: Tick; receivedAt: number }[] = [];
    source.on.tick((t) => {
      received.push({ tick: t, receivedAt: Date.now() });
    });

    // Generate one batch's worth of ticks (t is stamped "now" at generation time).
    await vi.advanceTimersByTimeAsync(50);
    expect(received).toHaveLength(0); // still buffered — nothing delivered immediately

    // Advance to just before the offset elapses: still nothing delivered.
    await vi.advanceTimersByTimeAsync(delayedOffsetMs - 100);
    expect(received).toHaveLength(0);

    // Advance past the offset: now ticks should have been released.
    await vi.advanceTimersByTimeAsync(200);
    expect(received.length).toBeGreaterThan(0);

    for (const { tick, receivedAt } of received) {
      const exchangeTimeMs = Date.parse(tick.t);
      expect(receivedAt - exchangeTimeMs).toBeGreaterThanOrEqual(delayedOffsetMs - 1);
      expect(tick.st).toBe('DELAYED');
    }

    source.disconnect();
  }, 20000);

  it('a LIVE demo user (user-001) receives ticks with no delay buffering', async () => {
    const source = new SimulatedSource(baseConfig({ demoUser: 'user-001' }));
    const universe = await source.getUniverse();
    source.subscribe(universe.symbols.map((s) => s.symbol));
    await source.connect();

    let firstReceivedAt: number | undefined;
    source.on.tick(() => {
      firstReceivedAt ??= Date.now();
    });

    await vi.advanceTimersByTimeAsync(50);
    expect(firstReceivedAt).toBeDefined();
    // Delivered within the same batch it was generated in (no 15s hold).
    expect((firstReceivedAt ?? 0) - Date.now()).toBeLessThanOrEqual(0);
    source.disconnect();
  }, 20000);
});
