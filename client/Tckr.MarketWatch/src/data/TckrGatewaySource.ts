/**
 * `TckrGatewaySource` — task 08. The real client-facing contract
 * (`docs/phase-3-web-client/client-contract.md`) over WebSocket + REST, implementing
 * `MarketDataSource` (task 02) exactly so it is a drop-in replacement for
 * `SimulatedSource`. Written and fixture-tested in Phase 3; unusable until a gateway
 * exists to serve it (Phase 11) — see `src/data/__tests__/conformance/**`.
 *
 * No network happens here that a test does not explicitly wire up: the WebSocket and
 * `fetch` are both injected (`TckrGatewaySourceDeps`), defaulting to the real globals
 * only for a genuine browser run. Every conformance test supplies `FakeWebSocket`
 * (`src/test-support/FakeWebSocket.ts`) and a stub `fetchImpl`.
 *
 * All mutable state is a true private (`#`) field/method, not merely TypeScript-private
 * — so the class's *runtime* public surface is exactly the five `MarketDataSource`
 * members (`connect`, `disconnect`, `subscribe`, `unsubscribe`, `getUniverse`,
 * `getSnapshot`, `on`, `identity`) with nothing else reachable via reflection. See
 * `conformance.surface.test.ts`.
 *
 * Backoff and the heartbeat watchdog are task 07's `src/data/reconnect.ts`
 * (`nextDelay`/`shouldReconnect`/`createHeartbeatWatchdog`) — that file landed mid-way
 * through this one being written (07 and 08 ran in parallel, both off the critical
 * path); this module was updated to import the real thing once it did, per the plan in
 * both task briefs ("If task 07 has not landed, implement against these signatures and
 * reconcile at merge").
 */
import { parseServerMessage, serializeClientMessage } from '../contracts/messages.ts';
import type {
  ClientMessage,
  Connected,
  EntitlementChanged,
  ErrorCode,
  ErrorMsg,
  IsoUtc,
  ServerMessage,
  Stream,
  Subscribed,
  Tick,
} from '../contracts/messages.ts';
import { toDecimal, type DecimalString } from '../contracts/decimal.ts';
import type { Snapshot, SymbolDefinition, SymbolUniverseResponse } from '../contracts/rest.ts';
import { CloseCode } from '../contracts/closeCodes.ts';
import type { ConnectionState, Identity, MarketDataSource } from './MarketDataSource.ts';
import type { ClientConfig } from './config.ts';
import { applySnapshot, primeUniverse } from './store.ts';
import { TickDispatcher } from './TickDispatcher.ts';
import { createHeartbeatWatchdog, DEFAULT_BACKOFF_POLICY, nextDelay, shouldReconnect, type HeartbeatWatchdog } from './reconnect.ts';

// ---------------------------------------------------------------------------
// Transport seams — real WebSocket/fetch by default, injectable for tests. Neither
// type depends on the DOM lib's `WebSocket`/`Response` types so this module compiles
// and tests run the same way regardless of which lib entries are configured.
// ---------------------------------------------------------------------------

/** The subset of the browser `WebSocket` surface this module uses. `FakeWebSocket`
 * implements this shape without opening a real socket. */
export interface GatewaySocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
}

type FetchResponseLike = { readonly ok: boolean; readonly status: number; json(): Promise<unknown> };
type FetchLike = (url: string) => Promise<FetchResponseLike>;

export interface TckrGatewaySourceDeps {
  /** Injectable for tests; defaults to `new TickDispatcher()`, matching how
   * `SimulatedSource` wires the coalescing path (see `SimulatedSourceDeps`). */
  readonly dispatcher?: TickDispatcher;
  /** Defaults to the global `WebSocket`. Every test supplies `FakeWebSocket` here. */
  readonly createSocket?: (url: string) => GatewaySocket;
  /** Defaults to the global `fetch`. Every test supplies a stub here. */
  readonly fetchImpl?: FetchLike;
  readonly now?: () => number;
  /** Source of jitter for reconnect backoff. Defaults to `Math.random`; tests inject a
   * deterministic function. Never called from inside the pure delay formula's policy
   * object itself — only at this call site, mirroring `reconnect.ts`'s own rule. */
  readonly random?: () => number;
}

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;

// ---------------------------------------------------------------------------
// Reconnect policy — client-contract.md §4: 500ms doubling to a 30s ceiling, ±20%
// jitter. `nextDelay`/`shouldReconnect` themselves live in task 07's
// `src/data/reconnect.ts` and are imported above; only the "what counts as a CloseCode
// at all" normalization is this module's own concern (see `toCloseCode`/
// `reconnectDecisionFor` below).
// ---------------------------------------------------------------------------

/** Normalizes a raw WebSocket close code to the contract's `CloseCode` union. The
 * contract defines exactly five codes; a real network/proxy layer can still produce
 * others (e.g. 1006 "abnormal closure", 1001 "going away"). Those are preserved
 * numerically (not coerced to one of the five) — see `reconnectDecisionFor` for how
 * they are then treated, and Notes for why this reading was chosen over dropping the
 * connection silently or inventing a sixth contract code. */
function toCloseCode(raw: number): CloseCode {
  switch (raw) {
    case CloseCode.Normal:
    case CloseCode.Unauthenticated:
    case CloseCode.TokenExpired:
    case CloseCode.HeartbeatTimeout:
    case CloseCode.SlowConsumer:
      return raw;
    default:
      return raw as CloseCode;
  }
}

/** `reconnect.ts`'s own `shouldReconnect` is written for exactly the five contract
 * close codes (its `switch` has no `default`) and is not defined for anything else. A
 * raw browser WebSocket can still close with a code outside that set (e.g. 1006) — those
 * are treated as a server fault and retried, the same as `INTERNAL`, without asking
 * `shouldReconnect` a question it was not designed to answer. */
function reconnectDecisionFor(code: CloseCode): boolean {
  switch (code) {
    case CloseCode.Normal:
    case CloseCode.Unauthenticated:
    case CloseCode.TokenExpired:
    case CloseCode.HeartbeatTimeout:
    case CloseCode.SlowConsumer:
      return shouldReconnect(code);
    default:
      return true;
  }
}

/** How long outbound control frames are held after a `RATE_LIMITED` error before
 * retrying. The contract specifies the error but not a magnitude — see Notes. */
const RATE_LIMIT_BACKOFF_MS = 2000;

function httpBase(gatewayUrl: string): string {
  if (gatewayUrl.startsWith('wss://')) return `https://${gatewayUrl.slice('wss://'.length)}`;
  if (gatewayUrl.startsWith('ws://')) return `http://${gatewayUrl.slice('ws://'.length)}`;
  return gatewayUrl;
}

function defaultCreateSocket(url: string): GatewaySocket {
  return new WebSocket(url) as unknown as GatewaySocket;
}

const defaultFetch: FetchLike = (url) => fetch(url) as unknown as Promise<FetchResponseLike>;

// ---------------------------------------------------------------------------
// REST body parsing — boundary validation for `GET /symbols` and
// `GET /symbols/{symbol}/snapshot`, in the same "never trust JSON at the edge" spirit
// as `contracts/messages.ts::parseServerMessage`. That module's own per-field
// validators are not exported (task 01 owns `contracts/**`), so this is a small,
// file-private duplicate — the same choice `SimulatedSource.ts` makes for its decimal
// helpers rather than reach into a frozen, differently-owned module.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function fail(context: string, detail: string): never {
  throw new TypeError(`${context}: ${detail}`);
}

function reqString(record: Record<string, unknown>, key: string, ctx: string): string {
  const value = record[key];
  if (typeof value !== 'string') fail(ctx, `expected string field "${key}"`);
  return value;
}

function reqNumber(record: Record<string, unknown>, key: string, ctx: string): number {
  const value = record[key];
  if (typeof value !== 'number') fail(ctx, `expected number field "${key}"`);
  return value;
}

function reqBoolean(record: Record<string, unknown>, key: string, ctx: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') fail(ctx, `expected boolean field "${key}"`);
  return value;
}

function reqStream(record: Record<string, unknown>, key: string, ctx: string): Stream {
  const value = reqString(record, key, ctx);
  if (value !== 'LIVE' && value !== 'DELAYED') fail(ctx, `invalid stream "${value}"`);
  return value;
}

function reqPrice(record: Record<string, unknown>, key: string, ctx: string): DecimalString {
  const raw = reqString(record, key, ctx);
  try {
    return toDecimal(raw);
  } catch {
    return fail(ctx, `invalid decimal price in field "${key}": ${JSON.stringify(raw)}`);
  }
}

function reqIso(record: Record<string, unknown>, key: string, ctx: string): IsoUtc {
  return reqString(record, key, ctx) as IsoUtc;
}

function parseSnapshotBody(value: unknown): Snapshot {
  if (!isRecord(value)) return fail('snapshot', 'expected an object');
  const context = 'snapshot';
  return {
    v: 1,
    symbol: reqString(value, 'symbol', context),
    stream: reqStream(value, 'stream', context),
    price: reqPrice(value, 'price', context),
    change: reqPrice(value, 'change', context),
    changePercent: reqString(value, 'changePercent', context),
    open: reqPrice(value, 'open', context),
    high: reqPrice(value, 'high', context),
    low: reqPrice(value, 'low', context),
    volume: reqNumber(value, 'volume', context),
    lastEventId: reqString(value, 'lastEventId', context),
    exchangeTimestamp: reqIso(value, 'exchangeTimestamp', context),
    snapshotAge: reqNumber(value, 'snapshotAge', context),
    simulated: reqBoolean(value, 'simulated', context),
  };
}

function parseSymbolDefinition(value: unknown): SymbolDefinition {
  if (!isRecord(value)) return fail('symbols-universe', 'expected an object in "symbols"');
  const context = 'symbols-universe';
  return {
    symbol: reqString(value, 'symbol', context),
    name: reqString(value, 'name', context),
    currency: reqString(value, 'currency', context),
    tickSize: reqPrice(value, 'tickSize', context),
    lotSize: reqNumber(value, 'lotSize', context),
    referencePrice: reqPrice(value, 'referencePrice', context),
  };
}

function parseUniverseBody(value: unknown): SymbolUniverseResponse {
  if (!isRecord(value)) return fail('symbols-universe', 'expected an object');
  const context = 'symbols-universe';
  const rawSymbols = value['symbols'];
  if (!Array.isArray(rawSymbols)) fail(context, 'expected array field "symbols"');
  return {
    v: 1,
    asOf: reqIso(value, 'asOf', context),
    simulated: reqBoolean(value, 'simulated', context),
    symbols: rawSymbols.map(parseSymbolDefinition),
  };
}

// ---------------------------------------------------------------------------
// TckrGatewaySource
// ---------------------------------------------------------------------------

/**
 * Real transport implementation of `MarketDataSource`. Constructed from the same
 * resolved `ClientConfig` task 02's `createMarketDataSource` already builds for
 * `SimulatedSource`, so wiring it in is exactly `new TckrGatewaySource(cfg)` — see
 * `config.ts`'s `createUnimplementedGatewaySource` placeholder, which this replaces.
 */
export class TckrGatewaySource implements MarketDataSource {
  readonly #config: ClientConfig;
  readonly #dispatcher: TickDispatcher;
  readonly #createSocket: (url: string) => GatewaySocket;
  readonly #fetchImpl: FetchLike;
  readonly #now: () => number;
  readonly #random: () => number;

  #socket: GatewaySocket | undefined;
  #identityValue: Identity | null = null;
  /** Mirrors whatever `ConnectionState` was last emitted through `on.status`, so
   * `connectionState()` can answer synchronously for a caller that subscribes *after*
   * the interesting transition already happened — the gap task 07 found: a component
   * that calls `getSharedSource()` and then `on.status(...)` necessarily misses
   * whatever was emitted synchronously inside `getSharedSource()` itself. Starts as a
   * `closed`/`Normal` state before `connect()` has ever been called — there is no
   * "never connected" member on `ConnectionState`, and `closed` is the nearest honest
   * fit for "nothing is happening yet". */
  #lastStatus: ConnectionState = { kind: 'closed', code: CloseCode.Normal, reason: 'not yet connected' };

  #universeCache: SymbolUniverseResponse | undefined;
  #universeInFlight: Promise<SymbolUniverseResponse> | undefined;

  readonly #subscribedSymbols = new Set<string>();
  #pendingOutbound: ClientMessage[] = [];
  #authWaiters: Array<() => void> = [];
  #authenticated = false;

  #throttledUntil = 0;
  #throttleTimer: ReturnType<typeof setTimeout> | undefined;

  #requestSeq = 0;

  #heartbeatIntervalMs: number | undefined;
  #heartbeatWatchdog: HeartbeatWatchdog | undefined;
  #pingTimer: ReturnType<typeof setInterval> | undefined;

  #backoffAttempt = 0;
  #connectAttempts = 0;
  #intentionalClose = false;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #connectResolvers: { resolve: () => void; reject: (err: Error) => void } | undefined;

  readonly #tickHandlers = new Set<(t: Tick) => void>();
  readonly #snapshotHandlers = new Set<(s: Snapshot) => void>();
  readonly #statusHandlers = new Set<(s: ConnectionState) => void>();
  readonly #errorHandlers = new Set<(e: ErrorMsg) => void>();
  readonly #entitlementHandlers = new Set<(e: EntitlementChanged) => void>();

  constructor(config: ClientConfig, deps: TckrGatewaySourceDeps = {}) {
    this.#config = config;
    this.#dispatcher = deps.dispatcher ?? new TickDispatcher();
    this.#createSocket = deps.createSocket ?? defaultCreateSocket;
    this.#fetchImpl = deps.fetchImpl ?? defaultFetch;
    this.#now = deps.now ?? Date.now;
    this.#random = deps.random ?? Math.random;
  }

  async connect(): Promise<void> {
    if (this.#socket && (this.#socket.readyState === SOCKET_OPEN || this.#socket.readyState === SOCKET_CONNECTING)) {
      return;
    }
    this.#intentionalClose = false;
    this.#connectAttempts += 1;
    this.#emitStatus({ kind: 'connecting', attempt: this.#connectAttempts });
    return this.#openSocket();
  }

  disconnect(): void {
    this.#intentionalClose = true;
    this.#clearReconnectTimer();
    this.#stopHeartbeat();
    this.#stopPing();
    this.#clearThrottleTimer();
    if (this.#socket) {
      this.#socket.close(CloseCode.Normal, 'client disconnect');
    } else {
      this.#emitStatus({ kind: 'closed', code: CloseCode.Normal, reason: 'client disconnect' });
    }
  }

  subscribe(symbols: readonly string[]): void {
    const wanted = symbols.filter((s) => s.length > 0);
    if (wanted.length === 0) {
      return;
    }
    for (const symbol of wanted) {
      this.#subscribedSymbols.add(symbol);
    }
    this.#send({ type: 'subscribe', symbols: wanted, requestId: this.#nextRequestId() });
  }

  unsubscribe(symbols: readonly string[]): void {
    const wanted = symbols.filter((s) => s.length > 0);
    if (wanted.length === 0) {
      return;
    }
    for (const symbol of wanted) {
      this.#subscribedSymbols.delete(symbol);
    }
    this.#send({ type: 'unsubscribe', symbols: wanted, requestId: this.#nextRequestId() });
  }

  async getUniverse(): Promise<SymbolUniverseResponse> {
    if (this.#universeCache) {
      return this.#universeCache;
    }
    if (this.#universeInFlight) {
      return this.#universeInFlight;
    }
    const promise = this.#fetchUniverse();
    this.#universeInFlight = promise;
    try {
      const result = await promise;
      this.#universeCache = result;
      return result;
    } finally {
      this.#universeInFlight = undefined;
    }
  }

  async getSnapshot(symbol: string): Promise<Snapshot> {
    const base = httpBase(this.#config.gatewayUrl);
    const res = await this.#fetchImpl(`${base}/symbols/${encodeURIComponent(symbol)}/snapshot`);
    if (!res.ok) {
      throw new Error(`getSnapshot(${symbol}): HTTP ${res.status}`);
    }
    const body = await res.json();
    const snapshot = parseSnapshotBody(body);
    this.#ingestSnapshot(snapshot, { broadcast: false });
    return snapshot;
  }

  readonly on = {
    tick: (h: (t: Tick) => void): (() => void) => {
      this.#tickHandlers.add(h);
      return () => this.#tickHandlers.delete(h);
    },
    snapshot: (h: (s: Snapshot) => void): (() => void) => {
      this.#snapshotHandlers.add(h);
      return () => this.#snapshotHandlers.delete(h);
    },
    status: (h: (s: ConnectionState) => void): (() => void) => {
      this.#statusHandlers.add(h);
      return () => this.#statusHandlers.delete(h);
    },
    error: (h: (e: ErrorMsg) => void): (() => void) => {
      this.#errorHandlers.add(h);
      return () => this.#errorHandlers.delete(h);
    },
    entitlement: (h: (e: EntitlementChanged) => void): (() => void) => {
      this.#entitlementHandlers.add(h);
      return () => this.#entitlementHandlers.delete(h);
    },
  };

  readonly identity = (): Identity | null => this.#identityValue;

  /**
   * Synchronous "current status" getter (an optional `MarketDataSource` member task 02
   * is adding in parallel — see task 07's finding: `getSharedSource()` connects
   * synchronously inside its own call, so a component that calls `on.status(...)`
   * afterwards necessarily misses whatever transition already happened). Always
   * present and always answers with whatever `ConnectionState` this source last
   * emitted through `on.status`, so a late subscriber and this getter never disagree.
   */
  readonly connectionState = (): ConnectionState => this.#lastStatus;

  // -------------------------------------------------------------------------
  // Internals — all true-private (`#`), so none of this is part of the runtime
  // public surface `conformance.surface.test.ts` compares against `SimulatedSource`.
  // -------------------------------------------------------------------------

  #openSocket(): Promise<void> {
    // Contract §3.1: browsers cannot set a WebSocket `Authorization` header, so the
    // token travels as `?access_token=` (the contract's own accommodation for this).
    // `ClientConfig` has no dedicated token field in Phase 3 (auth is Phase 8) — see
    // Notes for why `demoUser` stands in for it here.
    const token = this.#config.demoUser;
    const url = `${this.#config.gatewayUrl}/ws/market-data?access_token=${encodeURIComponent(token)}`;
    const socket = this.#createSocket(url);
    this.#socket = socket;
    this.#authenticated = false;
    return new Promise((resolve, reject) => {
      this.#connectResolvers = { resolve, reject };
      socket.onopen = () => {
        const resolvers = this.#connectResolvers;
        this.#connectResolvers = undefined;
        resolvers?.resolve();
      };
      socket.onmessage = (event) => this.#handleMessage(event.data);
      socket.onerror = () => {
        // The browser WebSocket API never carries error detail on this event; the
        // close that follows is what actually drives state (see #handleClose).
      };
      socket.onclose = (event) => this.#handleClose(event.code, event.reason);
    });
  }

  #handleMessage(raw: string): void {
    let message: ServerMessage;
    try {
      message = parseServerMessage(raw);
    } catch (err) {
      // Forward-compat (client-contract.md header): an unknown `type` or a malformed
      // frame is logged and dropped, never thrown into the UI.
      console.warn('TckrGatewaySource: dropping unparseable/unrecognized server message', err);
      return;
    }
    switch (message.type) {
      case 'connected':
        this.#handleConnected(message);
        return;
      case 'subscribed':
        this.#handleSubscribed(message);
        return;
      case 'unsubscribed':
        return;
      case 'tick':
        this.#handleTick(message);
        return;
      case 'snapshot':
        this.#ingestSnapshot(message.snapshot, { broadcast: true });
        return;
      case 'heartbeat':
        this.#heartbeatWatchdog?.pulse();
        return;
      case 'error':
        this.#handleError(message);
        return;
      case 'entitlementChanged':
        this.#handleEntitlementChanged(message);
        return;
    }
  }

  #handleConnected(message: Connected): void {
    this.#identityValue = { userId: message.userId, stream: message.stream, sessionId: message.sessionId };
    this.#heartbeatIntervalMs = message.heartbeatIntervalMs;
    this.#backoffAttempt = 0;
    this.#authenticated = true;
    this.#startHeartbeatMonitor();
    this.#startPing();
    this.#emitStatus({ kind: 'connected', since: this.#now() });
    this.#flushOutbound();
    const waiters = this.#authWaiters;
    this.#authWaiters = [];
    waiters.forEach((resolve) => resolve());
  }

  #handleSubscribed(message: Subscribed): void {
    for (const symbol of message.rejected) {
      // Contract note (task brief): rejected symbols surface as UNKNOWN_SYMBOL, never
      // a silent drop, and are not left in the tracked subscribed set.
      this.#subscribedSymbols.delete(symbol);
      this.#emitError('UNKNOWN_SYMBOL', `Symbol rejected by server: ${symbol}`, message.requestId);
    }
  }

  #handleTick(tick: Tick): void {
    this.#tickHandlers.forEach((h) => h(tick));
    this.#dispatcher.push(tick);
  }

  #handleError(message: ErrorMsg): void {
    this.#errorHandlers.forEach((h) => h(message));
    if (message.code === 'RATE_LIMITED') {
      this.#throttledUntil = this.#now() + RATE_LIMIT_BACKOFF_MS;
      this.#scheduleThrottleFlush();
    }
  }

  #handleEntitlementChanged(message: EntitlementChanged): void {
    if (this.#identityValue) {
      this.#identityValue = { ...this.#identityValue, stream: message.stream };
    }
    this.#entitlementHandlers.forEach((h) => h(message));
  }

  /** Shared by the REST `GET /symbols/{symbol}/snapshot` response and an unprompted
   * WS `snapshot` push (client-contract.md §3.3) — both write into the shared store
   * the same way; only the WS push also notifies `on.snapshot` subscribers, matching
   * `SimulatedSource`'s own `getSnapshot()` (which does not fire `on.snapshot` either,
   * since nothing "pushes" a snapshot there). */
  #ingestSnapshot(snapshot: Snapshot, opts: { readonly broadcast: boolean }): void {
    applySnapshot(snapshot);
    if (opts.broadcast) {
      this.#snapshotHandlers.forEach((h) => h(snapshot));
    }
  }

  #emitError(code: ErrorCode, text: string, requestId?: string): void {
    const event: ErrorMsg = {
      v: 1,
      type: 'error',
      code,
      message: text,
      ...(requestId !== undefined ? { requestId } : {}),
    };
    this.#errorHandlers.forEach((h) => h(event));
  }

  #emitStatus(state: ConnectionState): void {
    this.#lastStatus = state;
    this.#statusHandlers.forEach((h) => h(state));
  }

  #nextRequestId(): string {
    this.#requestSeq += 1;
    return `gw-${this.#requestSeq}`;
  }

  /** Outbound control frames never reach the wire before authentication (§3: nothing
   * is emitted to subscribers before `connected` arrives — this module reads that
   * symmetrically for the client's own sends too) and are held during a `RATE_LIMITED`
   * backoff window. Both cases queue rather than drop. */
  #send(msg: ClientMessage): void {
    if (!this.#authenticated || this.#now() < this.#throttledUntil || !this.#socket || this.#socket.readyState !== SOCKET_OPEN) {
      this.#pendingOutbound.push(msg);
      if (this.#now() < this.#throttledUntil) {
        this.#scheduleThrottleFlush();
      }
      return;
    }
    this.#socket.send(serializeClientMessage(msg));
  }

  #flushOutbound(): void {
    if (!this.#authenticated || this.#now() < this.#throttledUntil) {
      return;
    }
    if (!this.#socket || this.#socket.readyState !== SOCKET_OPEN) {
      return;
    }
    const queue = this.#pendingOutbound;
    this.#pendingOutbound = [];
    for (const msg of queue) {
      this.#socket.send(serializeClientMessage(msg));
    }
  }

  #scheduleThrottleFlush(): void {
    if (this.#throttleTimer !== undefined) {
      return;
    }
    const delay = Math.max(0, this.#throttledUntil - this.#now());
    this.#throttleTimer = setTimeout(() => {
      this.#throttleTimer = undefined;
      if (this.#now() < this.#throttledUntil) {
        // The throttle window was renewed (another RATE_LIMITED arrived) while this
        // timer was pending — reschedule against the new deadline instead of flushing
        // early.
        this.#scheduleThrottleFlush();
        return;
      }
      this.#flushOutbound();
    }, delay);
  }

  #clearThrottleTimer(): void {
    if (this.#throttleTimer !== undefined) {
      clearTimeout(this.#throttleTimer);
      this.#throttleTimer = undefined;
    }
  }

  /** client-contract.md §3.3: "A client that misses two consecutive heartbeats treats
   * the connection as dead and reconnects" — delegated to task 07's
   * `createHeartbeatWatchdog`, which arms a `2 * heartbeatIntervalMs` deadline and
   * resets it on every `pulse()` (called from `#handleMessage`'s `'heartbeat'` case). */
  #startHeartbeatMonitor(): void {
    this.#stopHeartbeat();
    const interval = this.#heartbeatIntervalMs;
    if (interval === undefined) {
      return;
    }
    this.#heartbeatWatchdog = createHeartbeatWatchdog(interval, () => {
      this.#forceLocalClose(CloseCode.HeartbeatTimeout, 'two consecutive heartbeats missed');
    });
  }

  #stopHeartbeat(): void {
    this.#heartbeatWatchdog?.stop();
    this.#heartbeatWatchdog = undefined;
  }

  /** The contract defines `ping` as a client→server message but does not mandate the
   * client ever send one unprompted — this is a Phase 3 liveness-probe choice, not a
   * contract requirement. See Notes. */
  #startPing(): void {
    this.#stopPing();
    const interval = this.#heartbeatIntervalMs;
    if (interval === undefined) {
      return;
    }
    this.#pingTimer = setInterval(() => {
      this.#send({ type: 'ping', requestId: this.#nextRequestId() });
    }, interval);
  }

  #stopPing(): void {
    if (this.#pingTimer !== undefined) {
      clearInterval(this.#pingTimer);
      this.#pingTimer = undefined;
    }
  }

  #forceLocalClose(code: CloseCode, reason: string): void {
    const socket = this.#socket;
    if (socket) {
      socket.close(code, reason);
    } else {
      this.#handleClose(code, reason);
    }
  }

  #handleClose(code: number, reason: string): void {
    this.#stopHeartbeat();
    this.#stopPing();
    this.#clearThrottleTimer();
    this.#authenticated = false;
    this.#socket = undefined;

    const resolvers = this.#connectResolvers;
    this.#connectResolvers = undefined;

    const closeCode = toCloseCode(code);
    this.#emitStatus({ kind: 'closed', code: closeCode, reason });

    if (resolvers) {
      resolvers.reject(new Error(`TckrGatewaySource: connection closed before open (code ${code}: ${reason})`));
    }

    if (this.#intentionalClose) {
      return;
    }
    if (!reconnectDecisionFor(closeCode)) {
      return;
    }
    this.#scheduleReconnect();
  }

  #scheduleReconnect(): void {
    this.#backoffAttempt += 1;
    const delay = nextDelay(this.#backoffAttempt, DEFAULT_BACKOFF_POLICY, this.#random);
    this.#emitStatus({ kind: 'reconnecting', attempt: this.#backoffAttempt, nextRetryMs: delay });
    this.#clearReconnectTimer();
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      void this.#reconnectNow();
    }, delay);
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer !== undefined) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }
  }

  #waitForAuthenticated(): Promise<void> {
    if (this.#authenticated) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.#authWaiters.push(resolve);
    });
  }

  /** client-contract.md §4's reconnect sequence: authenticate → resubscribe(all) →
   * snapshot → resume. "Resume" needs no explicit step — once re-authenticated and
   * resubscribed, ticks simply flow through `#handleMessage` as normal. */
  async #reconnectNow(): Promise<void> {
    try {
      await this.#openSocket();
      await this.#waitForAuthenticated();
    } catch {
      // #handleClose already ran for this attempt and has decided (via
      // reconnectDecisionFor) whether to schedule another one.
      return;
    }
    const symbols = Array.from(this.#subscribedSymbols);
    if (symbols.length === 0) {
      return;
    }
    this.subscribe(symbols);
    await Promise.allSettled(symbols.map((symbol) => this.getSnapshot(symbol)));
  }

  async #fetchUniverse(): Promise<SymbolUniverseResponse> {
    const base = httpBase(this.#config.gatewayUrl);
    const res = await this.#fetchImpl(`${base}/symbols`);
    if (!res.ok) {
      throw new Error(`getUniverse(): HTTP ${res.status}`);
    }
    const body = await res.json();
    const universe = parseUniverseBody(body);
    primeUniverse(
      universe.symbols.map((s) => ({ symbol: s.symbol, name: s.name, referencePrice: s.referencePrice })),
    );
    return universe;
  }
}
