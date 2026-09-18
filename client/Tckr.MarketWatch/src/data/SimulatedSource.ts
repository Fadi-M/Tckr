/**
 * A believable tape, not a correct one (client-contract.md §5). Everything specific to
 * the simulator lives here, behind the constructor — nothing on `MarketDataSource` knows
 * this class exists. See `config.ts` for the one place it is named.
 *
 * Universe: loaded from `public/symbols.json` (the byte-identical copy of the mock
 * exchange's own reference file this task also owns) via a static import — a plain data
 * import, not a network fetch, so the 34-instrument tape is available synchronously and
 * deterministically in both the browser and tests.
 *
 * Randomness: a seeded mulberry32 generator — never the platform's unseeded random
 * source. Same seed, same tape (see `simulated.determinism.test.ts`).
 *
 * Decimal arithmetic: `contracts/decimal.ts` exports `compare`/`subtract` but not
 * `add`/`multiply`, which a random walk needs (price ± n·tickSize). Rather than add to a
 * frozen, task-01-owned contract module for a need specific to this simulator, this file
 * carries its own small scaled-BigInt helpers (`scaledFromDecimal`/`decimalFromScaled`),
 * using the same 4-implied-decimal-digit convention and the same string/BigInt-only
 * technique — never the double-parsing globals this project bans on a price. See
 * "Notes for other tasks" in the task brief for the suggestion that `decimal.ts` grow
 * an `add` helper.
 *
 * ---------------------------------------------------------------------------------
 * EGX trading calendar — day-scoped sessions, not "since this tab connected"
 * ---------------------------------------------------------------------------------
 * This used to be one continuous random walk that started the moment `connect()` was
 * called and ran forever. Since this is explicitly Egyptian-market data, it now follows
 * EGX's real trading calendar (`./marketCalendar.ts`: Sunday–Thursday, ~10:00–14:30
 * Cairo time, DST-aware) instead: while the market is closed, no ticks are generated at
 * all and `getSnapshot`/`getHistory` reflect the most recently completed session's
 * *final* values, frozen; while open, the tape behaves exactly as before (live ticks,
 * `getHistory` growing every 30s) but bounded to the actual session window.
 *
 * The hard part is opening the app *mid-session* (or after a session has fully closed):
 * the client must reconstruct hours of history *instantly*, not by waiting through them
 * in real time. Replaying the live raw-tick engine (`generateOne()`, ~50ms cadence) to
 * "catch up" would be tens of millions of iterations for a 4.5-hour session — far too
 * slow to run synchronously on page load. `computeBackfilledSession` instead
 * reconstructs history at the 30-second *sample* granularity `getHistory` actually
 * returns (≤ ~540 iterations for a full session) using the same mean-reversion shape
 * `generateOne()` uses, scaled for a 30s aggregate step, seeded independently per
 * (symbol, calendar day) so the same day always backfills identically on reload. Once
 * caught up to "now" (market open case), the existing live raw-tick engine takes over
 * unchanged for going-forward generation, picking up from wherever the backfill left
 * `runtime.price`.
 *
 * This means backfilled slots and live-generated slots come from two different step
 * models sharing no PRNG state — a slot's value can differ slightly between "watched
 * live" and "backfilled after the fact for that same historical slot" on a later
 * reload. Accepted simplification for a fictional simulator: unifying the two engines
 * (e.g. making the live engine itself resumable/replayable at variable time
 * compression) would be a much larger change for no user-visible benefit here.
 *
 * "Is the market open right now" is deliberately *not* a `MarketDataSource` member —
 * see `marketCalendar.ts`'s own doc for why it's a plain, source-agnostic function both
 * this class and the UI call directly.
 */
import { percentChange, subtract, toDecimal, type DecimalString } from '../contracts/decimal.ts';
import type {
  EntitlementChanged,
  ErrorMsg,
  IsoUtc,
  Stream,
  Tick,
  TickKind,
} from '../contracts/messages.ts';
import type { HistoryPoint, Snapshot, SymbolDefinition, SymbolHistoryResponse, SymbolUniverseResponse } from '../contracts/rest.ts';
import { CloseCode } from '../contracts/closeCodes.ts';
import type { ConnectionState, Identity, MarketDataSource } from './MarketDataSource.ts';
import { applySnapshot, primeUniverse, resetStream } from './store.ts';
import { TickDispatcher } from './TickDispatcher.ts';
import { DEFAULT_BACKOFF_POLICY, nextDelay, shouldReconnect } from './reconnect.ts';
import { getMarketStatus, type MarketStatus } from './marketCalendar.ts';

import universeFile from '../../public/symbols.json';

// ---------------------------------------------------------------------------
// Universe — parsed once from the copied reference file.
// ---------------------------------------------------------------------------

interface RawSymbol {
  readonly symbol: string;
  readonly name: string;
  readonly referencePrice: number;
  readonly tickSize: number;
  readonly lotSize: number;
  readonly weight: number;
}

interface RawUniverseFile {
  readonly symbols: readonly RawSymbol[];
}

interface SimSymbol {
  readonly symbol: string;
  readonly name: string;
  readonly referencePrice: DecimalString;
  readonly tickSize: DecimalString;
  readonly lotSize: number;
  readonly weight: number;
}

/**
 * `raw.referencePrice`/`raw.tickSize` arrive as JSON number literals (unavoidable — the
 * copied file is JSON, and JSON has no decimal-string literal syntax). Converting via
 * `.toString()` is safe here and only here: these are curated reference constants with a
 * handful of significant digits, and `Number.prototype.toString()` is specified to
 * produce the shortest decimal string that round-trips to the same double, which for a
 * literal like `85.10` (stored as the nearest double, printed back as `"85.1"`) exactly
 * reproduces the digits that were written. This is a one-time bootstrap of static
 * reference data, not price arithmetic — none of the double-parsing globals this
 * project bans on a price path appear anywhere in this module.
 */
function numberToDecimal(value: number): DecimalString {
  return toDecimal(value.toString());
}

const SIM_SYMBOLS: readonly SimSymbol[] = (universeFile as RawUniverseFile).symbols.map((raw) => ({
  symbol: raw.symbol,
  name: raw.name,
  referencePrice: numberToDecimal(raw.referencePrice),
  tickSize: numberToDecimal(raw.tickSize),
  lotSize: raw.lotSize,
  weight: raw.weight,
}));

// ---------------------------------------------------------------------------
// Local fixed-point helpers (see module doc for why these are not imported).
// ---------------------------------------------------------------------------

const SCALE_DIGITS = 4;

function decimalPlacesOf(value: string): number {
  const dot = value.indexOf('.');
  return dot === -1 ? 0 : value.length - dot - 1;
}

function scaledFromDecimal(value: DecimalString): bigint {
  const negative = value.charAt(0) === '-';
  const hasSign = negative || value.charAt(0) === '+';
  const unsigned = hasSign ? value.slice(1) : value;
  const dot = unsigned.indexOf('.');
  const intPart = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const fracRaw = dot === -1 ? '' : unsigned.slice(dot + 1);
  const fracPart = fracRaw.padEnd(SCALE_DIGITS, '0');
  const magnitude = BigInt(intPart + fracPart);
  return negative ? -magnitude : magnitude;
}

function decimalFromScaled(scaled: bigint, decimals: number): DecimalString {
  const negative = scaled < 0n;
  const magnitude = negative ? -scaled : scaled;
  const digits = magnitude.toString().padStart(SCALE_DIGITS + 1, '0');
  const intPart = digits.slice(0, digits.length - SCALE_DIGITS);
  const fullFrac = digits.slice(digits.length - SCALE_DIGITS);
  const frac = decimals > 0 ? fullFrac.slice(0, decimals).padEnd(decimals, '0') : '';
  const body = decimals > 0 ? `${intPart}.${frac}` : intPart;
  const text = negative && magnitude !== 0n ? `-${body}` : body;
  return toDecimal(text);
}

function formatSignedPercent(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  const rounded = normalized.toFixed(2);
  return normalized > 0 ? `+${rounded}` : rounded;
}

// ---------------------------------------------------------------------------
// Seeded PRNG — mulberry32. Never the platform's unseeded random source.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class WeightedPicker {
  private readonly cumulative: readonly number[];
  private readonly total: number;

  constructor(private readonly symbols: readonly SimSymbol[]) {
    let running = 0;
    this.cumulative = symbols.map((s) => (running += s.weight));
    this.total = running;
  }

  pick(roll: number): SimSymbol {
    const target = roll * this.total;
    for (let i = 0; i < this.cumulative.length; i += 1) {
      const bound = this.cumulative[i];
      if (bound !== undefined && target < bound) {
        const symbol = this.symbols[i];
        if (symbol) {
          return symbol;
        }
      }
    }
    const last = this.symbols[this.symbols.length - 1];
    if (!last) {
      throw new Error('SimulatedSource: empty universe');
    }
    return last;
  }
}

// ---------------------------------------------------------------------------
// Per-symbol runtime state.
// ---------------------------------------------------------------------------

/** One session-history sample — see `getHistory`/`sampleHistory` below. */
interface HistorySample {
  readonly t: number;
  readonly price: bigint;
}

interface SymbolRuntime {
  readonly def: SimSymbol;
  readonly decimals: number;
  price: bigint;
  /** The active session's opening price — always `def.referencePrice` (see
   * `backfillAllSymbols`'s doc for why every trading day restarts from the same static
   * reference rather than carrying forward a previous day's close). Mutable, unlike an
   * earlier revision: it is reset on every new trading session, not set once at
   * construction. */
  open: bigint;
  high: bigint;
  low: bigint;
  volume: number;
  lastEventId: string;
  lastTimestamp: IsoUtc;
  /** The *active trading session's* price history, oldest first — either backfilled
   * instantly (see `computeBackfilledSession`) or grown live one sample at a time (see
   * `sampleHistory`), sampled independently of whether any page is currently watching
   * this symbol. Bounded by `HISTORY_MAX_POINTS`. Replaced wholesale whenever the
   * active session changes (a new calendar day, or an open/closed transition) — see
   * `backfillAllSymbols`. */
  history: HistorySample[];
}

interface DelayedEnvelope {
  readonly tick: Tick;
  readonly releaseAt: number;
}

interface SnapshotRequest {
  readonly symbol: string;
  readonly resolve: (snapshot: Snapshot) => void;
  readonly reject: (error: Error) => void;
}

export interface SimulatedSourceConfig {
  readonly eventsPerSecond: number;
  readonly delayedOffsetMs: number;
  readonly seed: number;
  readonly demoUser: string;
}

export interface SimulatedSourceDeps {
  readonly dispatcher?: TickDispatcher;
}

const BATCH_INTERVAL_MS = 50;

/** Session-history sampling cadence. Deliberately the same value as the display layer's
 * `DISPLAY_REFRESH_INTERVAL_MS` (`src/display/throttle.ts`) — not imported here, since
 * that constant belongs to the display layer and this data-layer file must not depend on
 * it (see README.md's layering rules) — so that a symbol's returned history and whatever
 * `PriceChart` samples next line up with no visible seam at the point they meet. */
const HISTORY_SAMPLE_INTERVAL_MS = 30_000;

/** Bounds a symbol's stored history (33+ hours at the cadence above) so a session left
 * running for days doesn't grow forever. No real demo session should ever reach this. */
const HISTORY_MAX_POINTS = 4000;

/** How often the market-open/closed check re-runs while the live tick engine is *not*
 * running (see `ensureSessionFor`) — the only way a closed→open transition (the market
 * opening while a tab is already sitting on a closed session) gets noticed, since
 * nothing else is ticking during that time. 1s is far tighter than needed for a clock
 * boundary that only ever falls on a fixed minute, and cheap since `ensureSessionFor`
 * itself no-ops instantly when nothing has changed. */
const MARKET_CLOCK_INTERVAL_MS = 1000;

/** Upper bound on how many tick-sized steps a single *backfilled* 30-second slot can
 * move — deliberately small so a full day's instantly-reconstructed line looks like a
 * plausible aggregate of many real ticks, not a wild jump. Not derived from
 * `eventsPerSecond`/symbol weight (which would make backfilled and live-generated
 * volatility match more closely) — see the module doc's documented tradeoff on why that
 * additional precision isn't worth the complexity here. */
const BACKFILL_MAX_STEPS_PER_SLOT = 6;

/** Upper bound on how many tick-sized steps a single *live* raw tick can move — "0..3
 * ticks, per spec" (`generateOne`). Deliberately a different value from
 * `BACKFILL_MAX_STEPS_PER_SLOT` above: a live tick and a backfilled 30s slot are not the
 * same unit of work (see the module doc's "two different step models" tradeoff), so
 * there is no reason their step ceilings should match. */
const LIVE_MAX_STEPS_PER_TICK = 4;

function resolveStream(demoUser: string): Stream {
  return demoUser === 'user-002' ? 'DELAYED' : 'LIVE';
}

/**
 * Deterministic per-(base seed, symbol, calendar day) uint32 seed for
 * `computeBackfilledSession`'s own, independent PRNG stream — FNV-1a over the
 * concatenated key. Independent of the live tick engine's shared `this.prng` (see the
 * module doc's "two different step models" tradeoff): backfilling one symbol must not
 * depend on how many *other* symbols the weighted picker happened to draw in between,
 * which the shared live stream is inherently entangled with.
 */
function hashSeed(baseSeed: number, symbol: string, sessionDateKey: string): number {
  const input = `${baseSeed}:${symbol}:${sessionDateKey}`;
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return hash >>> 0;
}

interface BackfilledSession {
  readonly open: bigint;
  readonly price: bigint;
  readonly high: bigint;
  readonly low: bigint;
  readonly volume: number;
  readonly history: HistorySample[];
}

/**
 * The mean-reversion step arithmetic shared by both step-generation engines
 * (`generateOne`'s live raw-tick engine and `computeBackfilledSession`'s instant
 * backfill engine — see the module doc's "two different step models" tradeoff). This
 * factors out only the arithmetic *shape* the two happen to compute identically; the
 * PRNG stream and step granularity stay exactly as separate as before — each caller
 * still passes its own `rng`, its own current `price`/`open`, and its own `maxSteps`
 * ceiling (`LIVE_MAX_STEPS_PER_TICK` vs. `BACKFILL_MAX_STEPS_PER_SLOT`).
 *
 * Draws from `rng` exactly twice, in a fixed order — first how many tick-sized steps to
 * consider (`0..maxSteps - 1`), then which direction, biased to mean-revert toward
 * `open` when `price` has already drifted away from it. The direction roll is drawn
 * unconditionally, even when the step count comes up `0`: `generateOne` shares a single
 * PRNG stream across this call and the kind/quantity rolls immediately after it, so the
 * number of draws consumed here must never depend on the outcome, or every downstream
 * roll would desynchronize from the stream a fixed seed is supposed to reproduce.
 */
function pickSignedSteps(rng: () => number, price: bigint, open: bigint, maxSteps: number): number {
  const steps = Math.floor(rng() * maxSteps);
  let upProbability = 0.5;
  if (price > open) {
    upProbability = 0.35; // mean-revert down
  } else if (price < open) {
    upProbability = 0.65; // mean-revert up
  }
  const goUp = rng() < upProbability;
  return steps === 0 ? 0 : goUp ? steps : -steps;
}

/**
 * Reconstructs one symbol's full trading-session state from `sessionOpenAt` up through
 * `targetTime` (either "now," for an open market, or the session's own close, for a
 * closed one) — instantly, at the 30-second sample granularity, rather than replaying
 * the live raw-tick engine (see the module doc for why that would be too slow). Every
 * trading day restarts from the symbol's static `referencePrice` (no persisted
 * cross-day closing price) — the simplest choice, and consistent with how
 * `store.ts`/`primeUniverse` already treat `referencePrice` as *the* one static anchor
 * for a symbol, not a rolling "yesterday's close."
 *
 * Pure and side-effect-free: easy to unit-test in isolation, and safe to call from
 * `ensureSessionFor` as often as a session/state transition requires.
 */
function computeBackfilledSession(def: SimSymbol, sessionOpenAt: number, targetTime: number, seed: number): BackfilledSession {
  const rng = mulberry32(seed);
  const open = scaledFromDecimal(def.referencePrice);
  const tickSizeScaled = scaledFromDecimal(def.tickSize);
  let price = open;
  let high = open;
  let low = open;
  let volume = 0;
  const history: HistorySample[] = [];
  const totalSlots = Math.max(0, Math.floor((targetTime - sessionOpenAt) / HISTORY_SAMPLE_INTERVAL_MS));

  for (let slot = 0; slot <= totalSlots; slot += 1) {
    if (slot > 0) {
      const signedSteps = pickSignedSteps(rng, price, open, BACKFILL_MAX_STEPS_PER_SLOT);
      let next = price + tickSizeScaled * BigInt(signedSteps);
      if (next < tickSizeScaled) {
        next = tickSizeScaled; // never non-positive
      }
      price = next;
      if (price > high) {
        high = price;
      }
      if (price < low) {
        low = price;
      }
      const lots = 1 + Math.floor(rng() * 10);
      volume += def.lotSize * lots;
    }
    history.push({ t: sessionOpenAt + slot * HISTORY_SAMPLE_INTERVAL_MS, price });
    if (history.length > HISTORY_MAX_POINTS) {
      history.shift(); // defensive only — a single session is far below this cap
    }
  }

  return { open, price, high, low, volume, history };
}

/** Browser-side implementation of `MarketDataSource`. No backend, no network — a seeded
 * random walk over the 34-instrument universe, held behind a delay buffer when the demo
 * user is entitled to DELAYED only. */
export class SimulatedSource implements MarketDataSource {
  private config: SimulatedSourceConfig;
  private readonly dispatcher: TickDispatcher;
  private readonly prng: () => number;
  private readonly picker = new WeightedPicker(SIM_SYMBOLS);
  private readonly runtimeBySymbol = new Map<string, SymbolRuntime>();
  private readonly subscribed = new Set<string>();
  private readonly delayQueue: DelayedEnvelope[] = [];
  private readonly snapshotRequests: SnapshotRequest[] = [];

  private readonly tickHandlers = new Set<(t: Tick) => void>();
  private readonly snapshotHandlers = new Set<(s: Snapshot) => void>();
  private readonly statusHandlers = new Set<(s: ConnectionState) => void>();
  private readonly errorHandlers = new Set<(e: ErrorMsg) => void>();
  private readonly entitlementHandlers = new Set<(e: EntitlementChanged) => void>();

  private identityValue: Identity | null = null;
  /** The live raw-tick engine (`generateOne()`, ~50ms cadence) — running if and only if
   * the market is currently open (see `ensureSessionFor`). `undefined` while the market
   * is closed; this is *not* the "are we connected at all" signal any more (a closed
   * market is a perfectly normal connected state) — that's `marketClockHandle`. */
  private intervalHandle: ReturnType<typeof setInterval> | undefined;
  /** Always running while connected, regardless of market state — the one thing that
   * makes `connect()`'s "already connected" guard and `simulateDrop`'s "are we
   * connected" check correct now that `intervalHandle` alone no longer implies that
   * (see `ensureSessionFor`, which this drives). */
  private marketClockHandle: ReturnType<typeof setInterval> | undefined;
  /** The calendar trading day (`marketCalendar.cairoDateKey` shape) every symbol's
   * `runtimeBySymbol` state currently reflects — `undefined` until the first
   * `ensureSessionFor` call ever backfills anything. Comparing against this (not
   * `Date`-based reasoning) is what `ensureSessionFor` uses to detect "a new trading
   * session has begun." */
  private currentSessionDateKey: string | undefined;
  /** The market state (`'open'`/`'closed'`) as of the last `ensureSessionFor` call —
   * compared against the freshly-computed state on every call to detect an open↔closed
   * transition, independent of whether the calendar day also changed. */
  private lastKnownMarketState: MarketStatus['state'] | undefined;
  private connectAttempt = 0;
  private sessionCounter = 0;
  private globalEventSeq = 0;
  private currentConnectionState: ConnectionState = {
    kind: 'closed',
    code: CloseCode.Normal,
    reason: 'not connected yet',
  };
  private backoffAttempt = 0;
  private dropReconnectTimer: ReturnType<typeof setTimeout> | undefined;
  /** Timestamp (ms) of the last *live* session-history sample, across every symbol —
   * see `sampleHistory`/`generateBatch`. Reset to whatever instant a backfill just
   * caught up to (see `ensureSessionFor`) so the next live sample lands a full
   * `HISTORY_SAMPLE_INTERVAL_MS` later, continuing seamlessly from the backfilled
   * history rather than immediately duplicating its own last slot. */
  private lastHistorySampleAt = -Infinity;

  constructor(config: SimulatedSourceConfig, deps: SimulatedSourceDeps = {}) {
    this.config = config;
    this.dispatcher = deps.dispatcher ?? new TickDispatcher();
    this.prng = mulberry32(config.seed);
    for (const def of SIM_SYMBOLS) {
      const decimals = Math.max(decimalPlacesOf(def.referencePrice), decimalPlacesOf(def.tickSize));
      const scaledReference = scaledFromDecimal(def.referencePrice);
      this.runtimeBySymbol.set(def.symbol, {
        def,
        decimals,
        price: scaledReference,
        open: scaledReference,
        high: scaledReference,
        low: scaledReference,
        volume: 0,
        lastEventId: `evt-${'0'.repeat(12)}`,
        lastTimestamp: new Date(0).toISOString() as IsoUtc,
        history: [],
      });
    }
    primeUniverse(SIM_SYMBOLS.map((s) => ({ symbol: s.symbol, name: s.name, referencePrice: s.referencePrice })));
  }

  async connect(): Promise<void> {
    if (this.marketClockHandle !== undefined) {
      return;
    }
    this.connectAttempt += 1;
    this.emitStatus({ kind: 'connecting', attempt: this.connectAttempt });
    this.identityValue = {
      userId: this.config.demoUser,
      stream: resolveStream(this.config.demoUser),
      sessionId: `sim-session-${(this.sessionCounter += 1)}`,
    };
    // Synchronously backfill/gate before announcing "connected", so a `getSnapshot()`/
    // `getHistory()` call issued the instant this promise resolves already sees
    // correctly day-scoped, market-hours-gated state — never a placeholder.
    this.ensureSessionFor(Date.now());
    this.marketClockHandle = setInterval(() => this.ensureSessionFor(Date.now()), MARKET_CLOCK_INTERVAL_MS);
    this.backoffAttempt = 0;
    this.emitStatus({ kind: 'connected', since: Date.now() });
  }

  disconnect(): void {
    this.clearDropReconnectTimer();
    if (this.marketClockHandle !== undefined) {
      clearInterval(this.marketClockHandle);
      this.marketClockHandle = undefined;
    }
    if (this.intervalHandle !== undefined) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    this.emitStatus({ kind: 'closed', code: CloseCode.Normal, reason: 'client disconnect' });
  }

  subscribe(symbols: readonly string[]): void {
    for (const symbol of symbols) {
      if (!this.runtimeBySymbol.has(symbol)) {
        this.emitError('UNKNOWN_SYMBOL', `Unknown symbol: ${symbol}`);
        continue;
      }
      this.subscribed.add(symbol);
    }
  }

  unsubscribe(symbols: readonly string[]): void {
    for (const symbol of symbols) {
      this.subscribed.delete(symbol);
    }
  }

  async getUniverse(): Promise<SymbolUniverseResponse> {
    const symbols: readonly SymbolDefinition[] = SIM_SYMBOLS.map((s) => ({
      symbol: s.symbol,
      name: s.name,
      currency: 'EGP',
      tickSize: s.tickSize,
      lotSize: s.lotSize,
      referencePrice: s.referencePrice,
    }));
    return {
      v: 1,
      asOf: new Date().toISOString() as IsoUtc,
      simulated: true,
      symbols,
    };
  }

  getSnapshot(symbol: string): Promise<Snapshot> {
    return new Promise((resolve, reject) => {
      this.snapshotRequests.push({ symbol, resolve, reject });
      // getSnapshot must never resolve synchronously (task 06 must not depend on
      // ordering the real gateway will not honour). Normally the live raw-tick engine
      // (`generateBatch`, ~50ms) drains this queue on its very next tick. But that
      // engine is idle whenever the market is closed (or this source was never
      // connected) — nothing would otherwise drain this queue except the much slower
      // 1s market clock (`ensureSessionFor`, which also drains it), so fall back to an
      // immediate macrotask in that case, so a snapshot fetch never has to wait on
      // market hours to resolve.
      if (this.intervalHandle === undefined) {
        setTimeout(() => this.drainSnapshotRequests(), 0);
      }
    });
  }

  /**
   * Every price sample recorded for the *active trading session* (see the module doc:
   * either the still-running session, if the market is open, or the most recently
   * completed one, if closed), oldest first — lets `PriceChart` render the full session
   * line immediately when a page opens a symbol mid-session or after the close, instead
   * of only the samples that happen to arrive after it starts watching. Independent of
   * `subscribe`/`getSnapshot`: history is maintained for every symbol regardless of
   * whether any page is currently subscribed to it.
   *
   * Unlike `getSnapshot`, this does not need to be queued against `generateBatch`'s own
   * timing — it only reads already-recorded state — so a plain `async` method (like
   * `getUniverse`) is enough; the promise still never resolves *synchronously* to a
   * caller's `.then()` (JS never resolves a promise before the next microtask), matching
   * the same "not merely convenient for the simulator" discipline as every other member.
   */
  async getHistory(symbol: string): Promise<SymbolHistoryResponse> {
    this.ensureSessionFor(Date.now());
    const runtime = this.runtimeBySymbol.get(symbol);
    if (!runtime) {
      throw new Error(`Unknown symbol: ${symbol}`);
    }
    const points: HistoryPoint[] = runtime.history.map((sample) => ({
      t: new Date(sample.t).toISOString() as IsoUtc,
      p: decimalFromScaled(sample.price, runtime.decimals),
    }));
    // Append the current live price as the freshest point, unless a sample already
    // landed at (or after) "now" — keeps the returned history's trailing edge seamless
    // with whatever `PriceChart` samples next, rather than leaving up to
    // `HISTORY_SAMPLE_INTERVAL_MS` of staleness at the exact moment a client asks. Only
    // while the market is *open*: a closed market's history must end exactly at the
    // session's real close, not be stretched with a flat line all the way to whatever
    // instant happens to be "now" — that would misrepresent "nothing has traded since
    // the close" as "the price has been live and flat for hours."
    const now = Date.now();
    if (getMarketStatus(now).state === 'open') {
      const last = points[points.length - 1];
      if (!last || Date.parse(last.t) < now) {
        points.push({ t: new Date(now).toISOString() as IsoUtc, p: decimalFromScaled(runtime.price, runtime.decimals) });
      }
    }
    return { v: 1, symbol, points };
  }

  readonly on = {
    tick: (h: (t: Tick) => void): (() => void) => {
      this.tickHandlers.add(h);
      return () => this.tickHandlers.delete(h);
    },
    snapshot: (h: (s: Snapshot) => void): (() => void) => {
      this.snapshotHandlers.add(h);
      return () => this.snapshotHandlers.delete(h);
    },
    status: (h: (s: ConnectionState) => void): (() => void) => {
      this.statusHandlers.add(h);
      return () => this.statusHandlers.delete(h);
    },
    error: (h: (e: ErrorMsg) => void): (() => void) => {
      this.errorHandlers.add(h);
      return () => this.errorHandlers.delete(h);
    },
    entitlement: (h: (e: EntitlementChanged) => void): (() => void) => {
      this.entitlementHandlers.add(h);
      return () => this.entitlementHandlers.delete(h);
    },
  };

  readonly identity = (): Identity | null => this.identityValue;

  /** The current `ConnectionState`, read synchronously — see `MarketDataSource`'s doc
   * for why this exists as well as (not instead of) `on.status`. */
  readonly connectionState = (): ConnectionState => this.currentConnectionState;

  /**
   * Simulator-only hook (not part of `MarketDataSource`): moves the demo user between
   * entitlement tiers at runtime and fires `entitlementChanged` if the resolved stream
   * actually changes. Exists so task 07's connection-lifecycle hook has a transition to
   * test; no page may call this — only a concrete `SimulatedSource` reference can.
   *
   * client-contract.md §3.3: a real stream switch must discard the old stream's
   * buffered data before any new-stream tick renders. This is the data layer's own
   * responsibility, not something left for a UI component to remember to do (see
   * `store.ts`'s `resetStream` doc and — for the incident this fixes — `StreamBadge`'s
   * module doc): `resetStream()` is called here, directly on the actual stream
   * transition, so the discard fires regardless of which components happen to be
   * mounted. It runs strictly *before* `entitlementHandlers.forEach(...)` below,
   * matching `resetStream`'s own documented guarantee ("clears everything, then fans
   * the discard out last") — any handler that reacts to `entitlementChanged`
   * synchronously already observes the cleared/re-anchored state.
   */
  simulateEntitlementChange(nextDemoUser: string): void {
    const previousStream = this.identityValue?.stream;
    this.config = { ...this.config, demoUser: nextDemoUser };
    const nextStream = resolveStream(nextDemoUser);
    if (this.identityValue) {
      this.identityValue = { ...this.identityValue, userId: nextDemoUser, stream: nextStream };
    }
    if (previousStream !== undefined && previousStream !== nextStream) {
      resetStream();
      const event: EntitlementChanged = {
        v: 1,
        type: 'entitlementChanged',
        stream: nextStream,
        resubscribeRequired: true,
        effectiveFrom: new Date().toISOString() as IsoUtc,
      };
      this.entitlementHandlers.forEach((h) => h(event));
    }
  }

  /**
   * Simulator-only hook (not part of `MarketDataSource`): drops the tape as if the
   * transport had just closed with `code`, so task 07's `ConnectionStatus` demo ("kill
   * the connection and watch it recover") has something to trigger. Mirrors
   * `TckrGatewaySource`'s own close/reconnect handling: emits `closed` immediately, then
   * — only when `reconnect.ts`'s `shouldReconnect(code)` says the code is recoverable
   * (everything except `4401 Unauthenticated`, which is terminal until the user
   * re-authenticates) — emits `reconnecting` with a jittered delay from the same
   * `nextDelay`/`DEFAULT_BACKOFF_POLICY` policy task 08 uses, then calls `connect()`
   * again after that delay. Jitter is drawn from this source's own seeded PRNG, never the
   * platform's unseeded random source, so a drop's recovery timing stays reproducible
   * under a fixed seed. A no-op if the source was not connected when called.
   */
  simulateDrop(code: CloseCode): void {
    if (this.marketClockHandle === undefined) {
      return; // not connected — nothing to drop
    }
    clearInterval(this.marketClockHandle);
    this.marketClockHandle = undefined;
    if (this.intervalHandle !== undefined) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    this.emitStatus({ kind: 'closed', code, reason: 'simulated drop' });

    if (!shouldReconnect(code)) {
      return;
    }
    this.backoffAttempt += 1;
    const delay = nextDelay(this.backoffAttempt, DEFAULT_BACKOFF_POLICY, this.prng);
    this.emitStatus({ kind: 'reconnecting', attempt: this.backoffAttempt, nextRetryMs: delay });
    this.clearDropReconnectTimer();
    this.dropReconnectTimer = setTimeout(() => {
      this.dropReconnectTimer = undefined;
      void this.connect();
    }, delay);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private clearDropReconnectTimer(): void {
    if (this.dropReconnectTimer !== undefined) {
      clearTimeout(this.dropReconnectTimer);
      this.dropReconnectTimer = undefined;
    }
  }

  private currentStream(): Stream {
    return this.identityValue?.stream ?? resolveStream(this.config.demoUser);
  }

  private emitStatus(state: ConnectionState): void {
    this.currentConnectionState = state;
    this.statusHandlers.forEach((h) => h(state));
  }

  private emitError(code: ErrorMsg['code'], message: string): void {
    const event: ErrorMsg = { v: 1, type: 'error', code, message };
    this.errorHandlers.forEach((h) => h(event));
  }

  private generateBatch(): void {
    const now = Date.now();
    // Tight (50ms) precision on the open→closed edge: the moment `now` crosses this
    // session's `sessionCloseAt`, this stops the very interval calling it (see
    // `ensureSessionFor`) — the separate `marketClockHandle` (1s) exists only to catch
    // the closed→open edge, which nothing else is running to notice while closed.
    this.ensureSessionFor(now);
    if (this.intervalHandle === undefined) {
      return; // ensureSessionFor just closed the market and stopped this very interval
    }
    if (now - this.lastHistorySampleAt >= HISTORY_SAMPLE_INTERVAL_MS) {
      this.sampleHistory(now);
      this.lastHistorySampleAt = now;
    }
    const perBatch = Math.max(1, Math.round((this.config.eventsPerSecond * BATCH_INTERVAL_MS) / 1000));
    for (let i = 0; i < perBatch; i += 1) {
      this.generateOne();
    }
    this.drainDelayedQueue();
    // Snapshot requests are drained by `ensureSessionFor` (called just above), which
    // also runs from the always-on `marketClockHandle` while the market is closed —
    // one place responsible for this, not two.
  }

  /**
   * The heart of the EGX-calendar behavior (see the module doc). Cheap to call as often
   * as needed — from the always-running `marketClockHandle` (1s) and, while the market
   * is open, from every `generateBatch()` (50ms) — because it only does real work
   * (`backfillAllSymbols`, an `O(session length / 30s)` operation) on an actual
   * transition, never on a call where nothing has changed.
   *
   * Also drains any queued `getSnapshot()` requests unconditionally: those used to be
   * drained only from `generateBatch()`, which only runs while the market is open — a
   * `getSnapshot()` call issued while closed would otherwise hang forever with no timer
   * left running to ever resolve it.
   */
  private ensureSessionFor(now: number): void {
    const status = getMarketStatus(now);
    const sessionChanged = status.sessionDateKey !== this.currentSessionDateKey;
    const stateChanged = status.state !== this.lastKnownMarketState;

    if (sessionChanged || stateChanged) {
      const target = status.state === 'open' ? now : status.sessionCloseAt;
      this.backfillAllSymbols(status.sessionDateKey, status.sessionOpenAt, target);
      this.currentSessionDateKey = status.sessionDateKey;
      // The next *live* sample (once/if the market is open) should land a full
      // interval after whatever instant backfill just caught up to, not immediately
      // duplicate the slot backfill already recorded for "now".
      this.lastHistorySampleAt = target;
    }
    this.lastKnownMarketState = status.state;

    const shouldBeRunning = status.state === 'open';
    const isRunning = this.intervalHandle !== undefined;
    if (shouldBeRunning && !isRunning) {
      this.intervalHandle = setInterval(() => this.generateBatch(), BATCH_INTERVAL_MS);
    } else if (!shouldBeRunning && isRunning) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }

    this.drainSnapshotRequests();
  }

  /** Overwrites every symbol's runtime state from an instant backfill of the session
   * identified by `sessionDateKey`/`sessionOpenAt`, up through `targetTime` — see
   * `computeBackfilledSession`'s doc for the "why 30s slots, not raw ticks" reasoning. */
  private backfillAllSymbols(sessionDateKey: string, sessionOpenAt: number, targetTime: number): void {
    for (const runtime of this.runtimeBySymbol.values()) {
      const seed = hashSeed(this.config.seed, runtime.def.symbol, sessionDateKey);
      const result = computeBackfilledSession(runtime.def, sessionOpenAt, targetTime, seed);
      runtime.open = result.open;
      runtime.price = result.price;
      runtime.high = result.high;
      runtime.low = result.low;
      runtime.volume = result.volume;
      runtime.history = result.history;
      runtime.lastTimestamp = new Date(targetTime).toISOString() as IsoUtc;
      runtime.lastEventId = `evt-bf-${sessionDateKey}-${runtime.def.symbol}`;
    }
  }

  /** Records one history sample per symbol, regardless of subscription state — the
   * session's price history is exchange-side ground truth, not something that should
   * depend on whether any client happens to be watching (see `getHistory`'s doc). Runs
   * for every symbol in the universe on every call, at most once per
   * `HISTORY_SAMPLE_INTERVAL_MS` (gated by the caller, `generateBatch`). */
  private sampleHistory(now: number): void {
    for (const runtime of this.runtimeBySymbol.values()) {
      runtime.history.push({ t: now, price: runtime.price });
      if (runtime.history.length > HISTORY_MAX_POINTS) {
        runtime.history.shift();
      }
    }
  }

  private generateOne(): void {
    const def = this.picker.pick(this.prng());
    const runtime = this.runtimeBySymbol.get(def.symbol);
    if (!runtime) {
      return;
    }

    const signedSteps = pickSignedSteps(this.prng, runtime.price, runtime.open, LIVE_MAX_STEPS_PER_TICK); // 0..3 ticks, per spec
    const tickSizeScaled = scaledFromDecimal(def.tickSize);
    let nextPrice = runtime.price + tickSizeScaled * BigInt(signedSteps);
    if (nextPrice < tickSizeScaled) {
      nextPrice = tickSizeScaled; // never non-positive
    }
    runtime.price = nextPrice;
    if (nextPrice > runtime.high) {
      runtime.high = nextPrice;
    }
    if (nextPrice < runtime.low) {
      runtime.low = nextPrice;
    }

    const kindRoll = this.prng();
    const kind: TickKind = kindRoll < 0.4 ? 'TRADE' : kindRoll < 0.7 ? 'BID' : 'ASK';
    const quantityLots = 1 + Math.floor(this.prng() * 5); // 1..5 lots
    const quantity = def.lotSize * quantityLots;
    runtime.volume += quantity;

    this.globalEventSeq += 1;
    const eventId = `evt-${String(this.globalEventSeq).padStart(12, '0')}`;
    const timestamp = new Date().toISOString() as IsoUtc;
    runtime.lastEventId = eventId;
    runtime.lastTimestamp = timestamp;

    const tick: Tick = {
      v: 1,
      type: 'tick',
      s: def.symbol,
      p: decimalFromScaled(nextPrice, runtime.decimals),
      q: quantity,
      k: kind,
      t: timestamp,
      id: eventId,
      st: this.currentStream(),
    };

    this.deliver(tick);
  }

  private deliver(tick: Tick): void {
    if (this.currentStream() === 'DELAYED') {
      this.delayQueue.push({ tick, releaseAt: Date.now() + this.config.delayedOffsetMs });
      return;
    }
    this.emit(tick);
  }

  private emit(tick: Tick): void {
    if (!this.subscribed.has(tick.s)) {
      return;
    }
    this.tickHandlers.forEach((h) => h(tick));
    this.dispatcher.push(tick);
  }

  private drainDelayedQueue(): void {
    const now = Date.now();
    while (this.delayQueue.length > 0) {
      const head = this.delayQueue[0];
      if (!head || head.releaseAt > now) {
        break;
      }
      this.delayQueue.shift();
      this.emit(head.tick);
    }
  }

  private drainSnapshotRequests(): void {
    if (this.snapshotRequests.length === 0) {
      return;
    }
    const batch = this.snapshotRequests.splice(0, this.snapshotRequests.length);
    for (const request of batch) {
      const runtime = this.runtimeBySymbol.get(request.symbol);
      if (!runtime) {
        request.reject(new Error(`Unknown symbol: ${request.symbol}`));
        continue;
      }
      const snapshot = this.buildSnapshot(request.symbol, runtime);
      applySnapshot(snapshot);
      request.resolve(snapshot);
    }
  }

  private buildSnapshot(symbol: string, runtime: SymbolRuntime): Snapshot {
    const priceDecimal = decimalFromScaled(runtime.price, runtime.decimals);
    const openDecimal = decimalFromScaled(runtime.open, runtime.decimals);
    const change = subtract(priceDecimal, openDecimal);
    const changePercentValue = percentChange(openDecimal, priceDecimal);
    return {
      v: 1,
      symbol,
      stream: this.currentStream(),
      price: priceDecimal,
      change,
      changePercent: formatSignedPercent(changePercentValue),
      open: openDecimal,
      high: decimalFromScaled(runtime.high, runtime.decimals),
      low: decimalFromScaled(runtime.low, runtime.decimals),
      volume: runtime.volume,
      lastEventId: runtime.lastEventId,
      exchangeTimestamp: runtime.lastTimestamp,
      snapshotAge: 0,
      simulated: true,
    };
  }
}
