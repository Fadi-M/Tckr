/**
 * Coalescing is the render contract, not an optimisation (README.md design decision #4).
 * At a hot symbol's share of a 25,000/sec tape (~15% on the real exchange skew, ~3,750
 * ticks/sec), one store write per tick would mean ~3,750 notifications/sec to a row that
 * can paint at 60fps. `TickDispatcher` writes at most once per symbol per animation frame:
 * price/timestamp/kind/id/stream are latest-value-wins (point-in-time samples, display-only),
 * but quantity (`q`) is summed across every tick coalesced into that flush, since volume is
 * a cumulative-sum quantity and store.applyTick adds the flushed `q` onto a running total —
 * dropping coalesced quantity would silently under-count volume. The un-coalesced tape is
 * still delivered in full via `MarketDataSource.on.tick`; this class only governs the
 * store-write path.
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

  /**
   * O(1): merges with any pending tick already queued for that symbol. Latest-wins is
   * correct for price/timestamp/kind/id/stream — they're point-in-time samples, and the
   * newest one is the only one that still matters for display. Volume is different: `q`
   * is a per-trade quantity that store.applyTick folds into a running cumulative sum, so
   * overwriting `q` (as a naive latest-wins merge would) silently discards the quantity
   * of every tick coalesced away this frame. We sum `q` across the coalesced burst while
   * still taking every other field from the latest tick, so exactly one flush per symbol
   * per frame still happens, but that flush carries the full traded quantity.
   */
  push(tick: Tick): void {
    this.received += 1;
    const existing = this.pending.get(tick.s);
    if (existing !== undefined) {
      this.coalesced += 1;
      this.pending.set(tick.s, { ...tick, q: existing.q + tick.q });
    } else {
      this.pending.set(tick.s, tick);
    }
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
