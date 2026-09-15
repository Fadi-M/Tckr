/**
 * Coalescing is the render contract, not an optimisation (README.md design decision #4).
 * At a hot symbol's share of a 25,000/sec tape (~15% on the real exchange skew, ~3,750
 * ticks/sec), one store write per tick would mean ~3,750 notifications/sec to a row that
 * can paint at 60fps. `TickDispatcher` keeps only the newest tick per symbol and writes
 * it into the store once per animation frame — latest-value-wins, display-only. The
 * un-coalesced tape is still delivered in full via `MarketDataSource.on.tick`; this class
 * only governs the store-write path.
 */
import { applyTick } from './store.ts';
import type { Tick } from '../contracts/messages.ts';

export type ScheduleFrame = (cb: () => void) => void;

const defaultScheduleFrame: ScheduleFrame = (cb) => {
  requestAnimationFrame(cb);
};

export interface DispatcherStats {
  readonly received: number;
  readonly flushed: number;
  readonly coalesced: number;
}

export class TickDispatcher {
  private readonly scheduleFrame: ScheduleFrame;
  private readonly onFlush: (tick: Tick) => void;
  private pending = new Map<string, Tick>();
  private frameRequested = false;
  private received = 0;
  private flushed = 0;
  private coalesced = 0;

  /**
   * @param scheduleFrame Injectable for tests; defaults to `requestAnimationFrame`.
   * @param onFlush Injectable sink for the coalesced tick, called once per symbol per
   *   flush. Defaults to `store.applyTick`, which is what wires this class into the
   *   `MarketDataSource → TickDispatcher → store` pipeline without any extra plumbing
   *   from a source implementation. Tests may override it to observe flushed values
   *   directly without touching the shared store singleton.
   */
  constructor(scheduleFrame: ScheduleFrame = defaultScheduleFrame, onFlush: (tick: Tick) => void = applyTick) {
    this.scheduleFrame = scheduleFrame;
    this.onFlush = onFlush;
  }

  /** O(1): overwrites any pending tick already queued for that symbol. */
  push(tick: Tick): void {
    this.received += 1;
    if (this.pending.has(tick.s)) {
      this.coalesced += 1;
    }
    this.pending.set(tick.s, tick);
    if (!this.frameRequested) {
      this.frameRequested = true;
      this.scheduleFrame(() => this.flushNow());
    }
  }

  /** Flushes whatever is pending immediately. A test hook, and also what the scheduled
   * frame callback calls internally. */
  flushNow(): void {
    this.frameRequested = false;
    if (this.pending.size === 0) {
      return;
    }
    const batch = this.pending;
    this.pending = new Map();
    for (const tick of batch.values()) {
      this.flushed += 1;
      this.onFlush(tick);
    }
  }

  get stats(): DispatcherStats {
    return { received: this.received, flushed: this.flushed, coalesced: this.coalesced };
  }
}
