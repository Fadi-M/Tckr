/**
 * The board's *painted* view of each symbol, and the one beat everything on screen moves
 * on.
 *
 * Throttling a component's store *notification* is not enough to pace what it shows:
 * `useSyncExternalStore` also reads its snapshot on every render, whatever caused the
 * render. When a row read the live store directly, anything else that re-rendered the
 * board (selecting a symbol, changing the sort, a hero re-pick) pulled every row's
 * newest, not-yet-painted price onto the screen between beats. Reading from here instead,
 * a render between beats shows exactly what the last beat painted.
 *
 * **One beat.** Every `DISPLAY_REFRESH_INTERVAL_MS`, on wall-clock slot boundaries
 * (`k·interval` in `Date.now()` time), every paced
 * symbol takes the store's current view and then every beat listener runs — the board's
 * re-rank, the hero re-pick, the detail header's repaint — all in the same task, so React
 * commits them as one frame. Prices, order and picks can never disagree, because they are
 * one read of the store at one instant. (They used to run on three clocks: a per-symbol
 * throttle, and two mount-relative 20s intervals for ranking and picks, which is how a
 * "Top gainer" came to show a falling price.)
 *
 * One paced view per symbol, shared by every reader (the board row, a highlight card,
 * the sort comparators and hero picks). A symbol is only paced while something
 * subscribes to it; with no subscribers, reads fall through to the store (so a row that
 * mounts later never starts from a stale view). The beat only runs while something
 * listens.
 *
 * A stream discard (LIVE ↔ DELAYED) is never paced: the old stream's figures are
 * dropped from the screen immediately (client-contract.md §3.3), not on the next beat.
 */
import type { SymbolView } from '../data/store.ts';
import { getSymbolSnapshot, onStreamDiscard } from '../data/store.ts';
import { DISPLAY_REFRESH_INTERVAL_MS } from './throttle.ts';

interface PacedEntry {
  view: SymbolView | undefined;
  readonly listeners: Set<() => void>;
}

const entries = new Map<string, PacedEntry>();
const beatListeners = new Set<() => void>();
let beatTimer: ReturnType<typeof setTimeout> | undefined;
let stopDiscardWatch: (() => void) | null = null;

function publish(symbol: string, entry: PacedEntry): void {
  const next = getSymbolSnapshot(symbol);
  if (next === entry.view) {
    return;
  }
  entry.view = next;
  for (const listener of [...entry.listeners]) {
    listener();
  }
}

function publishAll(): void {
  for (const [symbol, entry] of entries) {
    publish(symbol, entry);
  }
}

function beat(): void {
  beatTimer = undefined;
  publishAll();
  for (const listener of [...beatListeners]) {
    listener();
  }
  schedule();
}

function schedule(): void {
  if (beatTimer !== undefined || (entries.size === 0 && beatListeners.size === 0)) {
    return;
  }
  const now = Date.now();
  const nextSlot = (Math.floor(now / DISPLAY_REFRESH_INTERVAL_MS) + 1) * DISPLAY_REFRESH_INTERVAL_MS;
  beatTimer = setTimeout(beat, nextSlot - now);
}

function start(): void {
  stopDiscardWatch ??= onStreamDiscard(publishAll);
  schedule();
}

function stopIfIdle(): void {
  if (entries.size > 0 || beatListeners.size > 0) {
    return;
  }
  if (beatTimer !== undefined) {
    clearTimeout(beatTimer);
    beatTimer = undefined;
  }
  stopDiscardWatch?.();
  stopDiscardWatch = null;
}

/** The view the board last painted for `symbol` (the store's own view when nothing is
 * pacing it). Stable reference between beats. */
export function getPacedSymbolSnapshot(symbol: string): SymbolView | undefined {
  const entry = entries.get(symbol);
  return entry ? entry.view : getSymbolSnapshot(symbol);
}

/** Brings `symbol`'s paced view up to the store now, off the beat. For a figure the
 * user just asked for: opening a symbol fetches its latest snapshot for the detail pane,
 * and its board row and highlight card catch up to it at once instead of disagreeing
 * with the pane until the next beat. Every other symbol keeps its beat. */
export function flushPacedSymbol(symbol: string): void {
  const entry = entries.get(symbol);
  if (entry) {
    publish(symbol, entry);
  }
}

/** Subscribes to `symbol`'s paced view: `cb` fires on a beat when its view changed, and
 * immediately on a stream discard. */
export function subscribePacedSymbol(symbol: string, cb: () => void): () => void {
  let entry = entries.get(symbol);
  if (!entry) {
    entry = { view: getSymbolSnapshot(symbol), listeners: new Set() };
    entries.set(symbol, entry);
  }
  const active = entry;
  active.listeners.add(cb);
  start();
  return () => {
    active.listeners.delete(cb);
    if (active.listeners.size === 0 && entries.get(symbol) === active) {
      entries.delete(symbol);
    }
    stopIfIdle();
  };
}

/** Runs `cb` on every beat, after every paced view has been updated, in the same task —
 * for whatever must move in step with the prices (the board's order, the hero picks, the
 * detail header). */
export function subscribeBeat(cb: () => void): () => void {
  beatListeners.add(cb);
  start();
  return () => {
    beatListeners.delete(cb);
    stopIfIdle();
  };
}

/** Test hook: runs one beat now (publishes every paced view, then the beat listeners),
 * as if a wall-clock slot boundary had just passed. Not used by production code. */
export function beatNowForTests(): void {
  if (beatTimer !== undefined) {
    clearTimeout(beatTimer);
    beatTimer = undefined;
  }
  beat();
}
