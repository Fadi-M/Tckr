/**
 * Recorded contract-conformant fixtures, one JSON file per case. Consumed by this
 * task's own `messages.*.test.ts` suites and by task 08's gateway-source conformance
 * suite.
 *
 * `ALL_SERVER_MESSAGE_TYPES` and `ALL_ERROR_CODES` are declared through a
 * `Record<Union, true>` so that adding a member to `ServerMessage` or `ErrorCode`
 * without updating this file is a *compile* error (a missing/excess key on the
 * Record), and forgetting to add a fixture for it is a *test* failure
 * (`messages.coverage.test.ts`) — the pairing this module exists to guarantee cannot
 * silently regress.
 */
import type { ErrorCode, ServerMessage } from '../messages.ts';

import connectedLive from './connected-live.json';
import connectedDelayed from './connected-delayed.json';
import subscribedAllAccepted from './subscribed-all-accepted.json';
import subscribedPartialReject from './subscribed-partial-reject.json';
import unsubscribed from './unsubscribed.json';
import tickTrade from './tick-trade.json';
import tickBid from './tick-bid.json';
import tickAsk from './tick-ask.json';
import tickDelayed from './tick-delayed.json';
import snapshotLive from './snapshot-live.json';
import snapshotDelayed from './snapshot-delayed.json';
import heartbeat from './heartbeat.json';
import errorUnknownSymbol from './error-unknown-symbol.json';
import errorSubscriptionLimit from './error-subscription-limit.json';
import errorNotEntitled from './error-not-entitled.json';
import errorRateLimited from './error-rate-limited.json';
import errorInternal from './error-internal.json';
import entitlementUpgraded from './entitlement-upgraded.json';
import entitlementDowngraded from './entitlement-downgraded.json';
import symbolsUniverse from './symbols-universe.json';

/** Every fixture, keyed by case name. Values are raw parsed JSON (not yet passed
 * through `parseServerMessage`) — most are `ServerMessage`-shaped wire frames;
 * `symbols-universe` is a `SymbolUniverseResponse`-shaped REST body. */
export const FIXTURES = {
  'connected-live': connectedLive,
  'connected-delayed': connectedDelayed,
  'subscribed-all-accepted': subscribedAllAccepted,
  'subscribed-partial-reject': subscribedPartialReject,
  unsubscribed: unsubscribed,
  'tick-trade': tickTrade,
  'tick-bid': tickBid,
  'tick-ask': tickAsk,
  'tick-delayed': tickDelayed,
  'snapshot-live': snapshotLive,
  'snapshot-delayed': snapshotDelayed,
  heartbeat: heartbeat,
  'error-unknown-symbol': errorUnknownSymbol,
  'error-subscription-limit': errorSubscriptionLimit,
  'error-not-entitled': errorNotEntitled,
  'error-rate-limited': errorRateLimited,
  'error-internal': errorInternal,
  'entitlement-upgraded': entitlementUpgraded,
  'entitlement-downgraded': entitlementDowngraded,
  'symbols-universe': symbolsUniverse,
} as const;

export type FixtureName = keyof typeof FIXTURES;

/** Fixture names that are `ServerMessage` wire frames (i.e. every fixture except the
 * REST-shaped `symbols-universe`). Feed these through `parseServerMessage`. */
export const SERVER_MESSAGE_FIXTURE_NAMES: readonly FixtureName[] = (
  Object.keys(FIXTURES) as FixtureName[]
).filter((name) => name !== 'symbols-universe');

const SERVER_MESSAGE_TYPE_SET: Record<ServerMessage['type'], true> = {
  connected: true,
  subscribed: true,
  unsubscribed: true,
  tick: true,
  snapshot: true,
  heartbeat: true,
  error: true,
  entitlementChanged: true,
};

export const ALL_SERVER_MESSAGE_TYPES: readonly ServerMessage['type'][] = Object.keys(
  SERVER_MESSAGE_TYPE_SET,
) as ServerMessage['type'][];

const ERROR_CODE_SET: Record<ErrorCode, true> = {
  UNKNOWN_SYMBOL: true,
  SUBSCRIPTION_LIMIT: true,
  NOT_ENTITLED: true,
  RATE_LIMITED: true,
  INTERNAL: true,
};

export const ALL_ERROR_CODES: readonly ErrorCode[] = Object.keys(ERROR_CODE_SET) as ErrorCode[];
