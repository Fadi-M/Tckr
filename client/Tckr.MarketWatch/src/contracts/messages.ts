/**
 * TypeScript mirror of client-contract.md §3 (WebSocket — /ws/market-data). Every
 * server→client message is a member of `ServerMessage`; every client→server message
 * is a member of `ClientMessage`. `ClientMessage` deliberately has no `stream`, `tier`,
 * `delay` or `userId` field anywhere in its shape — adding one is a security defect
 * (FR-6), and `messages.outbound.test.ts` asserts this at both the type and the
 * runtime-serialization level.
 */
import { toDecimal, type DecimalString } from './decimal.ts';
import type { Snapshot } from './rest.ts';

export type Stream = 'LIVE' | 'DELAYED';
export type TickKind = 'TRADE' | 'BID' | 'ASK';
export type IsoUtc = string & { readonly __iso: unique symbol };

export interface Tick {
  readonly v: 1;
  readonly type: 'tick';
  readonly s: string; // symbol
  readonly p: DecimalString; // price
  readonly q: number; // quantity
  readonly k: TickKind;
  readonly t: IsoUtc; // exchangeTimestamp, preserved end to end
  readonly id: string; // eventId
  readonly st: Stream;
}

export interface Connected {
  readonly v: 1;
  readonly type: 'connected';
  readonly userId: string;
  readonly stream: Stream;
  readonly sessionId: string;
  readonly heartbeatIntervalMs: number;
  readonly serverTime: IsoUtc;
}

export interface Subscribed {
  readonly v: 1;
  readonly type: 'subscribed';
  readonly requestId?: string;
  readonly stream: Stream;
  readonly accepted: readonly string[];
  readonly rejected: readonly string[];
}

export interface Unsubscribed {
  readonly v: 1;
  readonly type: 'unsubscribed';
  readonly requestId?: string;
  readonly accepted: readonly string[];
}

export interface SnapshotMsg {
  readonly v: 1;
  readonly type: 'snapshot';
  readonly snapshot: Snapshot;
}

export interface Heartbeat {
  readonly v: 1;
  readonly type: 'heartbeat';
  readonly serverTime: IsoUtc;
}

export type ErrorCode =
  | 'UNKNOWN_SYMBOL'
  | 'SUBSCRIPTION_LIMIT'
  | 'NOT_ENTITLED'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export interface ErrorMsg {
  readonly v: 1;
  readonly type: 'error';
  readonly code: ErrorCode;
  readonly message: string;
  readonly requestId?: string;
}

export interface EntitlementChanged {
  readonly v: 1;
  readonly type: 'entitlementChanged';
  readonly stream: Stream;
  readonly resubscribeRequired: boolean;
  readonly effectiveFrom: IsoUtc;
}

export type ServerMessage =
  | Connected
  | Subscribed
  | Unsubscribed
  | Tick
  | SnapshotMsg
  | Heartbeat
  | ErrorMsg
  | EntitlementChanged;

// Outbound. There is deliberately no stream, tier, delay or userId field anywhere here.
export type ClientMessage =
  | { readonly type: 'subscribe'; readonly symbols: readonly string[]; readonly requestId?: string }
  | { readonly type: 'unsubscribe'; readonly symbols: readonly string[]; readonly requestId?: string }
  | { readonly type: 'ping'; readonly requestId?: string };

// ---------------------------------------------------------------------------
// Parsing — validates the discriminant and required fields, converts price/timestamp
// fields through their branded types, and silently ignores unknown fields (the
// contract's forward-compatibility rule, client-contract.md header).
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function fail(context: string, detail: string): never {
  throw new TypeError(`${context}: ${detail}`);
}

function requireString(record: Record<string, unknown>, key: string, context: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    fail(context, `expected string field "${key}"`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function requireNumber(record: Record<string, unknown>, key: string, context: string): number {
  const value = record[key];
  if (typeof value !== 'number') {
    fail(context, `expected number field "${key}"`);
  }
  return value;
}

/** Floor for `connected.heartbeatIntervalMs`. That field drives `TckrGatewaySource`'s
 * outbound ping timer (`setInterval(..., interval)`) and the heartbeat watchdog's
 * `2 * interval` disconnect deadline — both client-side timers taking their period
 * directly from a server-supplied number with no independent sanity check upstream. A
 * malicious/compromised gateway sending `0`, a negative value, or a vanishingly small
 * one would make the client flood outbound `ping` frames and collapse the watchdog
 * deadline toward zero, forcing repeated local closes/reconnect loops. One second is
 * far below any interval a real gateway would plausibly use (client-contract.md does
 * not name a value, but a production heartbeat cadence is measured in seconds, not
 * milliseconds) and comfortably rules out the pathological cases without constraining
 * any legitimate configuration. */
const MIN_HEARTBEAT_INTERVAL_MS = 1000;

function requireBoolean(record: Record<string, unknown>, key: string, context: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    fail(context, `expected boolean field "${key}"`);
  }
  return value;
}

function requireStringArray(
  record: Record<string, unknown>,
  key: string,
  context: string,
): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    fail(context, `expected string[] field "${key}"`);
  }
  return value;
}

function requireStream(record: Record<string, unknown>, key: string, context: string): Stream {
  const value = requireString(record, key, context);
  if (value !== 'LIVE' && value !== 'DELAYED') {
    fail(context, `invalid stream "${value}"`);
  }
  return value;
}

function requireTickKind(record: Record<string, unknown>, key: string, context: string): TickKind {
  const value = requireString(record, key, context);
  if (value !== 'TRADE' && value !== 'BID' && value !== 'ASK') {
    fail(context, `invalid tick kind "${value}"`);
  }
  return value;
}

function requireErrorCode(record: Record<string, unknown>, key: string, context: string): ErrorCode {
  const value = requireString(record, key, context);
  switch (value) {
    case 'UNKNOWN_SYMBOL':
    case 'SUBSCRIPTION_LIMIT':
    case 'NOT_ENTITLED':
    case 'RATE_LIMITED':
    case 'INTERNAL':
      return value;
    default:
      return fail(context, `invalid error code "${value}"`);
  }
}

function requirePrice(record: Record<string, unknown>, key: string, context: string): DecimalString {
  const raw = requireString(record, key, context);
  try {
    return toDecimal(raw);
  } catch {
    return fail(context, `invalid decimal price in field "${key}": ${JSON.stringify(raw)}`);
  }
}

function requireIso(record: Record<string, unknown>, key: string, context: string): IsoUtc {
  return requireString(record, key, context) as IsoUtc;
}

function parseSnapshot(value: unknown, context: string): Snapshot {
  if (!isRecord(value)) {
    return fail(context, 'expected an object for "snapshot"');
  }
  return {
    v: 1,
    symbol: requireString(value, 'symbol', context),
    stream: requireStream(value, 'stream', context),
    price: requirePrice(value, 'price', context),
    change: requirePrice(value, 'change', context),
    changePercent: requireString(value, 'changePercent', context),
    open: requirePrice(value, 'open', context),
    high: requirePrice(value, 'high', context),
    low: requirePrice(value, 'low', context),
    volume: requireNumber(value, 'volume', context),
    lastEventId: requireString(value, 'lastEventId', context),
    exchangeTimestamp: requireIso(value, 'exchangeTimestamp', context),
    snapshotAge: requireNumber(value, 'snapshotAge', context),
    simulated: requireBoolean(value, 'simulated', context),
  };
}

function parseConnected(record: Record<string, unknown>): Connected {
  const context = 'connected';
  const heartbeatIntervalMs = requireNumber(record, 'heartbeatIntervalMs', context);
  // See MIN_HEARTBEAT_INTERVAL_MS: `requireNumber` alone only checks the wire type, not
  // that the value is a sane timer period — reject anything at or below the floor
  // (including NaN/Infinity, which `Number.isFinite` catches) before it can reach
  // TckrGatewaySource's ping/heartbeat timers.
  if (!Number.isFinite(heartbeatIntervalMs) || heartbeatIntervalMs < MIN_HEARTBEAT_INTERVAL_MS) {
    fail(
      context,
      `heartbeatIntervalMs must be a finite number >= ${MIN_HEARTBEAT_INTERVAL_MS}, got ${heartbeatIntervalMs}`,
    );
  }
  return {
    v: 1,
    type: 'connected',
    userId: requireString(record, 'userId', context),
    stream: requireStream(record, 'stream', context),
    sessionId: requireString(record, 'sessionId', context),
    heartbeatIntervalMs,
    serverTime: requireIso(record, 'serverTime', context),
  };
}

function parseSubscribed(record: Record<string, unknown>): Subscribed {
  const context = 'subscribed';
  const requestId = optionalString(record, 'requestId');
  return {
    v: 1,
    type: 'subscribed',
    stream: requireStream(record, 'stream', context),
    accepted: requireStringArray(record, 'accepted', context),
    rejected: requireStringArray(record, 'rejected', context),
    ...(requestId !== undefined ? { requestId } : {}),
  };
}

function parseUnsubscribed(record: Record<string, unknown>): Unsubscribed {
  const context = 'unsubscribed';
  const requestId = optionalString(record, 'requestId');
  return {
    v: 1,
    type: 'unsubscribed',
    accepted: requireStringArray(record, 'accepted', context),
    ...(requestId !== undefined ? { requestId } : {}),
  };
}

function parseTick(record: Record<string, unknown>): Tick {
  const context = 'tick';
  return {
    v: 1,
    type: 'tick',
    s: requireString(record, 's', context),
    p: requirePrice(record, 'p', context),
    q: requireNumber(record, 'q', context),
    k: requireTickKind(record, 'k', context),
    t: requireIso(record, 't', context),
    id: requireString(record, 'id', context),
    st: requireStream(record, 'st', context),
  };
}

function parseSnapshotMsg(record: Record<string, unknown>): SnapshotMsg {
  return {
    v: 1,
    type: 'snapshot',
    snapshot: parseSnapshot(record['snapshot'], 'snapshot'),
  };
}

function parseHeartbeat(record: Record<string, unknown>): Heartbeat {
  return {
    v: 1,
    type: 'heartbeat',
    serverTime: requireIso(record, 'serverTime', 'heartbeat'),
  };
}

function parseError(record: Record<string, unknown>): ErrorMsg {
  const context = 'error';
  const requestId = optionalString(record, 'requestId');
  return {
    v: 1,
    type: 'error',
    code: requireErrorCode(record, 'code', context),
    message: requireString(record, 'message', context),
    ...(requestId !== undefined ? { requestId } : {}),
  };
}

function parseEntitlementChanged(record: Record<string, unknown>): EntitlementChanged {
  const context = 'entitlementChanged';
  return {
    v: 1,
    type: 'entitlementChanged',
    stream: requireStream(record, 'stream', context),
    resubscribeRequired: requireBoolean(record, 'resubscribeRequired', context),
    effectiveFrom: requireIso(record, 'effectiveFrom', context),
  };
}

/** Parses one server→client wire frame. Throws on an unknown `type` or a missing
 * required field; silently ignores fields it does not recognize. */
export function parseServerMessage(raw: string): ServerMessage {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new TypeError('Server message must be a JSON object');
  }
  const type = parsed['type'];
  if (typeof type !== 'string') {
    throw new TypeError('Server message missing string "type" field');
  }
  switch (type) {
    case 'connected':
      return parseConnected(parsed);
    case 'subscribed':
      return parseSubscribed(parsed);
    case 'unsubscribed':
      return parseUnsubscribed(parsed);
    case 'tick':
      return parseTick(parsed);
    case 'snapshot':
      return parseSnapshotMsg(parsed);
    case 'heartbeat':
      return parseHeartbeat(parsed);
    case 'error':
      return parseError(parsed);
    case 'entitlementChanged':
      return parseEntitlementChanged(parsed);
    default:
      throw new TypeError(`Unknown server message type: ${JSON.stringify(type)}`);
  }
}

// ---------------------------------------------------------------------------
// Serialization — outbound only. Explicitly allowlists fields per message type so
// that even a runtime bypass of the ClientMessage type (an unsafe cast, a spread from
// an untyped object) cannot smuggle an extra field such as `stream` onto the wire.
// ---------------------------------------------------------------------------

function pickDefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
}

/** Serializes a `ClientMessage` to JSON, allowlisting only the fields that belong to
 * its `type`. Never emits `stream`, `tier`, `delay` or `userId` (FR-6). */
export function serializeClientMessage(message: ClientMessage): string {
  switch (message.type) {
    case 'subscribe':
      return JSON.stringify(
        pickDefined({ type: message.type, symbols: message.symbols, requestId: message.requestId }),
      );
    case 'unsubscribe':
      return JSON.stringify(
        pickDefined({ type: message.type, symbols: message.symbols, requestId: message.requestId }),
      );
    case 'ping':
      return JSON.stringify(pickDefined({ type: message.type, requestId: message.requestId }));
  }
}
