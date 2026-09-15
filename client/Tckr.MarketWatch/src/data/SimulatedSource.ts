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
import type { Snapshot, SymbolDefinition, SymbolUniverseResponse } from '../contracts/rest.ts';
import { CloseCode } from '../contracts/closeCodes.ts';
import type { ConnectionState, Identity, MarketDataSource } from './MarketDataSource.ts';
import { applySnapshot, primeUniverse } from './store.ts';
import { TickDispatcher } from './TickDispatcher.ts';
import { DEFAULT_BACKOFF_POLICY, nextDelay, shouldReconnect } from './reconnect.ts';

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

interface SymbolRuntime {
  readonly def: SimSymbol;
  readonly decimals: number;
  price: bigint;
  readonly open: bigint;
  high: bigint;
  low: bigint;
  volume: number;
  lastEventId: string;
  lastTimestamp: IsoUtc;
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

function resolveStream(demoUser: string): Stream {
  return demoUser === 'user-002' ? 'DELAYED' : 'LIVE';
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
  private intervalHandle: ReturnType<typeof setInterval> | undefined;
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
      });
    }
    primeUniverse(SIM_SYMBOLS.map((s) => ({ symbol: s.symbol, name: s.name, referencePrice: s.referencePrice })));
  }

  async connect(): Promise<void> {
    if (this.intervalHandle !== undefined) {
      return;
    }
    this.connectAttempt += 1;
    this.emitStatus({ kind: 'connecting', attempt: this.connectAttempt });
    this.identityValue = {
      userId: this.config.demoUser,
      stream: resolveStream(this.config.demoUser),
      sessionId: `sim-session-${(this.sessionCounter += 1)}`,
    };
    this.intervalHandle = setInterval(() => this.generateBatch(), BATCH_INTERVAL_MS);
    this.backoffAttempt = 0;
    this.emitStatus({ kind: 'connected', since: Date.now() });
  }

  disconnect(): void {
    this.clearDropReconnectTimer();
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
      // ordering the real gateway will not honour) — if generation is not running yet
      // (connect() not called), fall back to a macrotask so the promise still settles.
      if (this.intervalHandle === undefined) {
        setTimeout(() => this.drainSnapshotRequests(), 0);
      }
    });
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
   */
  simulateEntitlementChange(nextDemoUser: string): void {
    const previousStream = this.identityValue?.stream;
    this.config = { ...this.config, demoUser: nextDemoUser };
    const nextStream = resolveStream(nextDemoUser);
    if (this.identityValue) {
      this.identityValue = { ...this.identityValue, userId: nextDemoUser, stream: nextStream };
    }
    if (previousStream !== undefined && previousStream !== nextStream) {
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
    if (this.intervalHandle === undefined) {
      return; // nothing to drop
    }
    clearInterval(this.intervalHandle);
    this.intervalHandle = undefined;
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
    const perBatch = Math.max(1, Math.round((this.config.eventsPerSecond * BATCH_INTERVAL_MS) / 1000));
    for (let i = 0; i < perBatch; i += 1) {
      this.generateOne();
    }
    this.drainDelayedQueue();
    this.drainSnapshotRequests();
  }

  private generateOne(): void {
    const def = this.picker.pick(this.prng());
    const runtime = this.runtimeBySymbol.get(def.symbol);
    if (!runtime) {
      return;
    }

    const steps = Math.floor(this.prng() * 4); // 0..3 ticks, per spec
    let upProbability = 0.5;
    if (runtime.price > runtime.open) {
      upProbability = 0.35; // mean-revert down
    } else if (runtime.price < runtime.open) {
      upProbability = 0.65; // mean-revert up
    }
    const goUp = this.prng() < upProbability;
    const signedSteps = steps === 0 ? 0 : goUp ? steps : -steps;
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
