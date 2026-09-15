import { describe, expect, it } from 'vitest';
import { toDecimal } from '../../contracts/decimal.ts';
import type { Tick } from '../../contracts/messages.ts';
import { TickDispatcher, type ScheduleFrame } from '../TickDispatcher.ts';

function tick(symbol: string, price: string, id: string): Tick {
  return {
    v: 1,
    type: 'tick',
    s: symbol,
    p: toDecimal(price),
    q: 100,
    k: 'TRADE',
    t: '2026-09-12T10:31:04.881Z' as Tick['t'],
    id,
    st: 'LIVE',
  };
}

function manualScheduler(): { schedule: ScheduleFrame; runFrame: () => void } {
  let queued: (() => void) | undefined;
  return {
    schedule: (cb) => {
      queued = cb;
    },
    runFrame: () => {
      const cb = queued;
      queued = undefined;
      cb?.();
    },
  };
}

describe('TickDispatcher latest-value-wins', () => {
  it('flushes the last pushed tick for a symbol, never an earlier one', () => {
    const flushed: Tick[] = [];
    const scheduler = manualScheduler();
    const dispatcher = new TickDispatcher(scheduler.schedule, (t) => flushed.push(t));

    dispatcher.push(tick('COMI', '85.00', 'evt-1'));
    dispatcher.push(tick('COMI', '85.05', 'evt-2'));
    dispatcher.push(tick('COMI', '85.42', 'evt-3'));

    scheduler.runFrame();

    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.id).toBe('evt-3');
    expect(flushed[0]?.p).toBe('85.42');
  });

  it('tracks each symbol independently: the latest per symbol survives, not one global latest', () => {
    const flushed: Tick[] = [];
    const scheduler = manualScheduler();
    const dispatcher = new TickDispatcher(scheduler.schedule, (t) => flushed.push(t));

    dispatcher.push(tick('COMI', '85.00', 'evt-1'));
    dispatcher.push(tick('CIB', '62.75', 'evt-2'));
    dispatcher.push(tick('COMI', '85.10', 'evt-3'));
    dispatcher.push(tick('CIB', '62.80', 'evt-4'));

    scheduler.runFrame();

    const bySymbol = new Map(flushed.map((t) => [t.s, t]));
    expect(bySymbol.size).toBe(2);
    expect(bySymbol.get('COMI')?.id).toBe('evt-3');
    expect(bySymbol.get('CIB')?.id).toBe('evt-4');
  });

  it('a fresh push after a flush starts a new pending value, not the stale one', () => {
    const flushed: Tick[] = [];
    const scheduler = manualScheduler();
    const dispatcher = new TickDispatcher(scheduler.schedule, (t) => flushed.push(t));

    dispatcher.push(tick('COMI', '85.00', 'evt-1'));
    scheduler.runFrame();
    dispatcher.push(tick('COMI', '85.50', 'evt-2'));
    scheduler.runFrame();

    expect(flushed.map((t) => t.id)).toEqual(['evt-1', 'evt-2']);
  });
});
