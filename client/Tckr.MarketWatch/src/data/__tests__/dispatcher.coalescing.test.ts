/**
 * `TickDispatcher` under a hot symbol's load: any number of ticks between two frames
 * becomes one flush per symbol, carrying the latest price and the summed quantity, so the
 * paint path never sees more than one update per symbol per frame and never drops volume.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Tick } from '../../contracts/messages.ts';
import { TickDispatcher, type ScheduleFrame } from '../TickDispatcher.ts';
import { tick } from './testSupport.ts';

/** A frame scheduler under manual control: `runFrame()` runs the queued callback. */
function createManualScheduler(): { schedule: ScheduleFrame; runFrame: () => void } {
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

function burstTick(i: number, prefix = 'evt'): Tick {
  return tick('COMI', (85 + i * 0.0001).toFixed(4), `${prefix}-${i}`, { q: 10 });
}

describe('TickDispatcher coalescing', () => {
  let flushed: Tick[] = [];
  let scheduler: ReturnType<typeof createManualScheduler>;
  let dispatcher: TickDispatcher;

  beforeEach(() => {
    flushed = [];
    scheduler = createManualScheduler();
    dispatcher = new TickDispatcher(scheduler.schedule, (t) => flushed.push(t));
  });

  it('flushes a 3,750-tick burst once, with the latest tick and every tick’s quantity', () => {
    for (let i = 0; i < 3750; i += 1) dispatcher.push(burstTick(i));
    expect(dispatcher.stats).toMatchObject({ received: 3750, coalesced: 3749, flushed: 0 });

    scheduler.runFrame();

    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toMatchObject({ id: 'evt-3749', p: '85.3749', q: 37_500 });
  });

  it('sustains at least 50x coalescing over 60 frames of 3,750 ticks', () => {
    for (let frame = 0; frame < 60; frame += 1) {
      for (let i = 0; i < 3750; i += 1) dispatcher.push(burstTick(i, `evt-${frame}`));
      scheduler.runFrame();
    }
    const { received, flushed: flushCount } = dispatcher.stats;
    expect(received).toBe(225_000);
    expect(flushCount).toBe(60);
    expect(received / flushCount).toBeGreaterThanOrEqual(50);
  });

  it('keeps the latest tick per symbol, not one global latest', () => {
    dispatcher.push(tick('COMI', '85.00', 'evt-1'));
    dispatcher.push(tick('CIB', '62.75', 'evt-2'));
    dispatcher.push(tick('COMI', '85.10', 'evt-3'));
    dispatcher.push(tick('CIB', '62.80', 'evt-4'));

    scheduler.runFrame();

    expect(new Map(flushed.map((t) => [t.s, t.id]))).toEqual(
      new Map([
        ['COMI', 'evt-3'],
        ['CIB', 'evt-4'],
      ]),
    );
  });

  it('starts a fresh pending value after each flush', () => {
    dispatcher.push(tick('COMI', '85.00', 'evt-1'));
    scheduler.runFrame();
    dispatcher.push(tick('COMI', '85.50', 'evt-2'));
    scheduler.runFrame();
    expect(flushed.map((t) => t.id)).toEqual(['evt-1', 'evt-2']);
  });

  it('flushNow drains synchronously and leaves the scheduled frame a no-op', () => {
    dispatcher.push(tick('COMI', '85.00', 'evt-a'));
    dispatcher.push(tick('COMI', '85.05', 'evt-b'));
    dispatcher.flushNow();
    scheduler.runFrame();
    expect(flushed.map((t) => t.id)).toEqual(['evt-b']);
  });
});
