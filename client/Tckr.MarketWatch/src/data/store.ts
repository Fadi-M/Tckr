/**
 * The external store `useSyncExternalStore` reads (task 04/05/06), with per-symbol
 * subscriptions: a tick for COMI must notify only COMI's row, never the other 33
 * (README.md design decision #9). This module holds the only mutable price state in the
 * client; `TickDispatcher` and the source implementations write into it, components only
 * read from it via `subscribeSymbol` / `getSymbolSnapshot` / `getSymbolList`.
 *
 * `getSymbolSnapshot` returns the *same object reference* for a symbol until that
 * symbol's view actually changes — a new object on every call sends
 * `useSyncExternalStore` into an infinite re-render loop. See `store.stability.test.ts`.
 *
 * `applyTick` / `applySnapshot` / `primeUniverse` / `resetStore` / `resetStream` are the
 * write-side API. They are exported (not private) because `TickDispatcher` and the
 * source implementations live in sibling files within `src/data/`, but they are not part
 * of the surface pages code against — pages use only the three read functions and
 * `SymbolView`.
 *
 * `resetStream` exists separately from `resetStore` for client-contract.md §3.3's
 * `entitlementChanged` requirement: "the client must ... discard any buffered ticks from
 * the old stream rather than mixing the two on one chart." `resetStore` wipes the primed
 * universe too (`symbolList`/names/reference prices), which would leave `StockList` with
 * nothing to re-render from — it is a test-only hook. `resetStream` clears only the
 * per-symbol price/quote state a stream switch must not carry forward, and keeps the
 * universe intact so the list can immediately fall back to its pre-tick, muted
 * reference-price display instead of going blank.
 *
 * `onStreamDiscard` is the store-level signal for that same event: any component that
 * needs to react to a discard (e.g. a chart clearing its ring buffer) subscribes here
 * instead of reaching into another leaf component to find out. `resetStream()` itself
 * calls these listeners — after every per-symbol view is already cleared and every
 * baseline already re-anchored to `referencePrice` — so "discard the old stream" is one
 * signal from the module that owns the discarded state, not two separate things a caller
 * must remember to do in order.
 */
import { percentChange, subtract, type DecimalString } from '../contracts/decimal.ts';
import type { Snapshot } from '../contracts/rest.ts';
import type { Stream, Tick } from '../contracts/messages.ts';

/** A row's worth of live state. Change/changePercent are computed relative to a tracked
 * baseline: the most recent snapshot's `open`, or — before any snapshot has been seen —
 * the symbol's static `referencePrice` from the universe (see `primeUniverse`). This is
 * the same role a session's opening price plays in the real contract's `Snapshot.open`. */
export interface SymbolView {
  readonly symbol: string;
  readonly name: string;
  readonly price: DecimalString;
  readonly change: DecimalString;
  readonly changePercent: number;
  readonly volume: number;
  readonly lastUpdate: number;
  readonly stream: Stream;
}

type Listener = () => void;

interface SymbolMeta {
  name: string;
  /** The static, universe-level reference price — set once by `primeUniverse` and never
   * overwritten afterward. This is what `resetStream` restores `baseline` to, discarding
   * whatever a snapshot on the old stream had moved it to. */
  referencePrice: DecimalString;
  /** The current change/changePercent baseline: a snapshot's `open` once one has been
   * seen for this symbol, else `referencePrice`. */
  baseline: DecimalString;
}

interface SymbolRecord {
  view: SymbolView | undefined;
  listeners: Set<Listener>;
}

const records = new Map<string, SymbolRecord>();
const meta = new Map<string, SymbolMeta>();
let symbolList: readonly string[] = [];
const streamDiscardListeners = new Set<Listener>();

function recordFor(symbol: string): SymbolRecord {
  const existing = records.get(symbol);
  if (existing) {
    return existing;
  }
  const created: SymbolRecord = { view: undefined, listeners: new Set() };
  records.set(symbol, created);
  return created;
}

function notify(symbol: string): void {
  const record = records.get(symbol);
  if (!record) {
    return;
  }
  for (const listener of record.listeners) {
    listener();
  }
}

function sameSymbolList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((symbol, index) => symbol === b[index]);
}

// ---------------------------------------------------------------------------
// Read API — the only surface pages (04/05/06) should code against.
// ---------------------------------------------------------------------------

/** Subscribes to changes for one symbol. Returns an unsubscribe function, matching the
 * `on.*(h) => () => void` convention used across `MarketDataSource`. */
export function subscribeSymbol(symbol: string, cb: () => void): () => void {
  const record = recordFor(symbol);
  record.listeners.add(cb);
  return () => {
    record.listeners.delete(cb);
  };
}

/** Stable reference between changes (see module doc); `undefined` until the symbol has
 * received a snapshot or tick. */
export function getSymbolSnapshot(symbol: string): SymbolView | undefined {
  return records.get(symbol)?.view;
}

/** The tradeable universe's symbols, in the order `primeUniverse` last set them. Stable
 * reference between changes. */
export function getSymbolList(): readonly string[] {
  return symbolList;
}

/**
 * Subscribes to the store-level "old stream discarded" signal — fired by `resetStream()`
 * once every per-symbol view is cleared and every baseline is re-anchored to
 * `referencePrice` (client-contract.md §3.3: an `entitlementChanged` stream switch must
 * discard the old stream's buffered data, never mix it with the new one on one chart). A
 * listener reading `getSymbolSnapshot` from inside this callback always sees the
 * already-cleared state. Returns an unsubscribe function, matching the `on.*(h) => ()
 * => void` convention used elsewhere in `src/data/`.
 */
export function onStreamDiscard(listener: () => void): () => void {
  streamDiscardListeners.add(listener);
  return () => {
    streamDiscardListeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// Write API — used by source implementations and `TickDispatcher`.
// ---------------------------------------------------------------------------

/** Registers the tradeable universe's static metadata (name, reference price) so that a
 * bare `Tick` — which carries neither — can be turned into a full `SymbolView`. Also sets
 * `getSymbolList()`. Idempotent; re-priming with the same symbol list keeps the list's
 * object reference. Does not touch an already-tracked baseline (a snapshot's `open`
 * takes precedence once one has been seen for that symbol). */
export function primeUniverse(
  symbols: readonly { readonly symbol: string; readonly name: string; readonly referencePrice: DecimalString }[],
): void {
  for (const def of symbols) {
    const existing = meta.get(def.symbol);
    meta.set(def.symbol, {
      name: def.name,
      referencePrice: def.referencePrice,
      baseline: existing?.baseline ?? def.referencePrice,
    });
  }
  const nextList = symbols.map((def) => def.symbol);
  if (!sameSymbolList(nextList, symbolList)) {
    symbolList = nextList;
  }
}

/** Applies a full `Snapshot` (from `getSnapshot()` or an unprompted `snapshot` push) to
 * the store, replacing that symbol's view and re-anchoring its change baseline on
 * `snapshot.open`. `now` is injectable for deterministic tests.
 *
 * Security: `snapshot.symbol` is server-controlled and only shape-validated (a string)
 * by `parseServerMessage` — it is never checked against membership in anything before
 * reaching here. An unprompted WS `snapshot` push (client-contract.md §3.3) reaches
 * this function the same way a tick does (`TckrGatewaySource#handleMessage`'s
 * `'snapshot'` case calls it unconditionally), so a compromised/misbehaving gateway
 * could otherwise push an unbounded number of distinct, arbitrary symbols and grow
 * `meta`/`records` without limit — the same unbounded-heap-growth risk `applyTick`
 * guards against below, and arguably worse here since this function is also the only
 * writer (besides `primeUniverse`) that can create a brand-new `meta` entry. Guarded
 * the same way: drop anything for a symbol that was never primed into `meta` by the
 * real tradeable universe, rather than trusting the wire to say what's real. */
export function applySnapshot(snapshot: Snapshot, now: number = Date.now()): void {
  const existing = meta.get(snapshot.symbol);
  if (!existing) {
    console.warn(
      `store: dropping snapshot for symbol "${snapshot.symbol}" not in the primed universe`,
    );
    return;
  }
  const name = existing.name;
  meta.set(snapshot.symbol, { name, referencePrice: existing.referencePrice, baseline: snapshot.open });
  const record = recordFor(snapshot.symbol);
  record.view = {
    symbol: snapshot.symbol,
    name,
    price: snapshot.price,
    change: snapshot.change,
    changePercent: percentChange(snapshot.open, snapshot.price),
    volume: snapshot.volume,
    lastUpdate: now,
    stream: snapshot.stream,
  };
  notify(snapshot.symbol);
}

/** Applies one (already-coalesced-per-frame) tick to the store. Volume accumulates
 * across ticks, seeded from the last snapshot's cumulative volume if any. `now` is
 * injectable for deterministic tests.
 *
 * Security: `tick.s` is server-controlled and only shape-validated (a string) by
 * `parseServerMessage` — nothing upstream checks it against the actual
 * subscribed/universe symbol set. Without this guard, a compromised or misbehaving
 * gateway could send `tick` frames for an unbounded number of distinct, arbitrary `s`
 * values, each one creating a permanent `records` entry that is never evicted —
 * unbounded heap growth and an eventual tab crash. `meta` is populated only from the
 * real tradeable universe (`primeUniverse`, called from `SimulatedSource`'s
 * constructor and `TckrGatewaySource#fetchUniverse`), so "not in `meta`" is this
 * module's only trustworthy definition of "not a real symbol" — mirroring how
 * `SimulatedSource.subscribe()` rejects an unrecognized symbol with `UNKNOWN_SYMBOL`
 * rather than acting on it. `store.ts` has no error-handler surface to raise an
 * equivalent error on, so this drops silently (bar the warning) instead. */
export function applyTick(tick: Tick, now: number = Date.now()): void {
  const symbolMeta = meta.get(tick.s);
  if (!symbolMeta) {
    console.warn(`store: dropping tick for symbol "${tick.s}" not in the primed universe`);
    return;
  }
  const record = recordFor(tick.s);
  const baseline = symbolMeta.baseline;
  const name = symbolMeta.name;
  const previousVolume = record.view?.volume ?? 0;
  record.view = {
    symbol: tick.s,
    name,
    price: tick.p,
    change: subtract(tick.p, baseline),
    changePercent: percentChange(baseline, tick.p),
    volume: previousVolume + tick.q,
    lastUpdate: now,
    stream: tick.st,
  };
  notify(tick.s);
}

/**
 * client-contract.md §3.3: on `entitlementChanged`, discard any buffered ticks from the
 * old stream rather than mixing LIVE and DELAYED data in one view. Clears every symbol's
 * price/quote view (so `getSymbolSnapshot` goes back to `undefined`, the same "no tick
 * yet" state a symbol is in before its first tick — `StockList`/`StockDetail` already
 * know how to render that from the universe's reference price) and resets each symbol's
 * change baseline back to the pristine, static `referencePrice`, discarding whatever the
 * old stream's snapshot had moved it to. Preserves the primed universe: `symbolList`,
 * every symbol's `name`, and its `referencePrice` are left exactly as they were. Notifies
 * every symbol that had a view, so subscribed components re-render immediately, and —
 * once all of the above is done — fires every `onStreamDiscard` listener.
 */
export function resetStream(): void {
  for (const [symbol, record] of records) {
    if (record.view !== undefined) {
      record.view = undefined;
      notify(symbol);
    }
  }
  for (const [symbol, symbolMeta] of meta) {
    meta.set(symbol, {
      name: symbolMeta.name,
      referencePrice: symbolMeta.referencePrice,
      baseline: symbolMeta.referencePrice,
    });
  }
  for (const listener of streamDiscardListeners) {
    listener();
  }
}

/** Test hook: clears all store state, including the primed universe and any
 * `onStreamDiscard` subscriptions. Not used by production code — `resetStream` is the
 * production-safe equivalent that a stream switch should call. */
export function resetStore(): void {
  records.clear();
  meta.clear();
  symbolList = [];
  streamDiscardListeners.clear();
}
