import { beforeEach, describe, expect, it } from 'vitest';
import { toDecimal } from '../../contracts/decimal.ts';
import type { Tick } from '../../contracts/messages.ts';
import { TickDispatcher, type ScheduleFrame } from '../TickDispatcher.ts';

function tick(price: string, id: string, q = 100): Tick {
  return {
    v: 1,
    type: 'tick',
    s: 'COMI',
    p: toDecimal(price),
    q,
    k: 'TRADE',
    t: '2026-09-12T10:31:04.881Z' as Tick['t'],
    id,
    st: 'LIVE',
  };
}

/** A frame scheduler under full manual control: `runFrame()` invokes exactly the
 * callbacks queued since the last run, in order. */
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

describe('TickDispatcher coalescing', () => {
  let flushed: Tick[] = [];
  let scheduler: ReturnType<typeof createManualScheduler>;
  let dispatcher: TickDispatcher;

  beforeEach(() => {
    flushed = [];
    scheduler = createManualScheduler();
    dispatcher = new TickDispatcher(scheduler.schedule, (t) => flushed.push(t));
  });

  it('produces exactly one flush per symbol per frame for a burst of 3,750 ticks', () => {
    for (let i = 0; i < 3750; i += 1) {
      dispatcher.push(tick((85 + i * 0.0001).toFixed(4), `evt-${i}`));
    }
    expect(dispatcher.stats.received).toBe(3750);
    expect(dispatcher.stats.coalesced).toBe(3749);
    expect(dispatcher.stats.flushed).toBe(0); // not flushed until the frame runs

    scheduler.runFrame();

    expect(flushed).toHaveLength(1);
    expect(dispatcher.stats.flushed).toBe(1);
  });

  it('sustains a coalescing ratio of at least 50x over a 60-frame run', () => {
    const perFrame = 3750;
    const frames = 60;
    for (let frame = 0; frame < frames; frame += 1) {
      for (let i = 0; i < perFrame; i += 1) {
        dispatcher.push(tick((85 + i * 0.0001).toFixed(4), `evt-${frame}-${i}`));
      }
      scheduler.runFrame();
    }
    const { received, flushed: flushedCount } = dispatcher.stats;
    expect(received).toBe(perFrame * frames);
    expect(flushedCount).toBe(frames);
    const ratio = received / flushedCount;
    expect(ratio).toBeGreaterThanOrEqual(50);
    // Measured coalescing ratio for the phase record (task 09 reads this number):
    // eslint-disable-next-line no-console
    console.info(`[dispatcher.coalescing] received=${received} flushed=${flushedCount} ratio=${ratio}x`);
  });

  it('never flushes more than one pending tick per symbol between frames', () => {
    dispatcher.push(tick('85.00', 'evt-a'));
    dispatcher.push(tick('85.05', 'evt-b'));
    dispatcher.push(tick('85.10', 'evt-c'));
    scheduler.runFrame();
    expect(flushed).toHaveLength(1);
  });

  it('sums the quantity of every coalesced tick into the single flush, never dropping volume', () => {
    for (let i = 0; i < 3750; i += 1) {
      dispatcher.push(tick((85 + i * 0.0001).toFixed(4), `evt-${i}`, 10));
    }
    scheduler.runFrame();

    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.q).toBe(3750 * 10);
    // Every other field still reflects the latest tick, not some merged/summed value.
    expect(flushed[0]?.id).toBe('evt-3749');
  });

  it('flushNow is a synchronous test hook independent of the scheduled frame', () => {
    dispatcher.push(tick('85.00', 'evt-a'));
    dispatcher.push(tick('85.05', 'evt-b'));
    dispatcher.flushNow();
    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.id).toBe('evt-b');
    // The frame that was scheduled for this burst should now be a no-op.
    scheduler.runFrame();
    expect(flushed).toHaveLength(1);
  });
});
