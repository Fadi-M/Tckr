# Tckr Client-Facing Contract — v1

> **Frozen in Phase 3, served for real from Phase 11 onward.** This is the interface
> between `Tckr.MarketData.Gateway` and any client — the Phase 3 web client, a future
> mobile app, or a third party. It is deliberately written before the gateway exists so
> that the gateway is built to a contract rather than the contract being back-derived
> from an implementation.
>
> Parent: [`README.md`](README.md) · [`../MASTER CONTEXT.md`](../MASTER%20CONTEXT.md) ·
> requirements: [`../requirements.md`](../requirements.md)

**Versioning.** This document describes `v1`. Every WebSocket envelope carries
`"v": 1`. A breaking change means `v2` and a new endpoint path; the gateway may serve
both during a migration. Additive optional fields are not breaking — clients must
ignore unknown fields rather than fail on them.

---

## 1. Design rules

1. **JSON over the wire, not the exchange's binary format.** The exchange wire protocol
   ([`../phase-2-mock-exchange/wire-protocol.md`](../phase-2-mock-exchange/wire-protocol.md))
   stops at ingestion. Nothing downstream of Kafka should be able to tell what the
   exchange's framing looked like.
2. **Prices are decimal strings, never JSON numbers.** `"85.42"`, not `85.42`. IEEE-754
   doubles cannot represent every decimal price exactly, and JavaScript parses every
   bare JSON number as a double. The client parses to a decimal-safe type for arithmetic
   and formats from the string for display. This is the wire-level continuation of
   [ADR 001](../decisions/001-mock-exchange-wire-protocol.md)'s no-floating-point rule.
3. **The server states the stream; the client never asks for one.** Every subscription
   acknowledgement and every tick names its `stream` (`LIVE` or `DELAYED`). There is no
   field in any client→server message that can influence it (FR-6).
4. **Timestamps are ISO-8601 UTC with millisecond precision**, always suffixed `Z`.
   `exchangeTimestamp` is the exchange's own time and is preserved end to end — a
   DELAYED tick carries the original exchange time, not its release time (FR-4).
5. **The client is a display, not a ledger.** It may miss ticks (NFR-3.1 coalescing,
   reconnects). Anything that must not miss an event consumes Kafka, not this contract.

---

## 2. REST

### `GET /symbols`

The tradeable universe. Static enough to cache for the session; not a market-data feed.

```json
{
  "v": 1,
  "asOf": "2026-09-12T09:15:00.000Z",
  "simulated": true,
  "symbols": [
    { "symbol": "COMI", "name": "Commercial International Holding",
      "currency": "EGP", "tickSize": "0.05", "lotSize": 100,
      "referencePrice": "85.10" }
  ]
}
```

`simulated: true` marks a universe that is not real market reference data. The Phase 2
symbol universe is fictional and its own file says so; a client that renders this feed
**must** surface that flag to the user (see [ADR 006](../decisions/006-client-data-source-contract.md)).

### `GET /symbols/{symbol}/snapshot`

Current state for one symbol, used to paint a screen before the stream arrives and to
recover after a reconnect (DS-3).

```json
{
  "v": 1,
  "symbol": "COMI",
  "stream": "LIVE",
  "price": "85.42",
  "change": "+1.05",
  "changePercent": "+1.24",
  "open": "84.37",
  "high": "85.90",
  "low": "84.10",
  "volume": 216637,
  "lastEventId": "evt-000000000216637",
  "exchangeTimestamp": "2026-09-12T10:31:04.881Z",
  "snapshotAge": 42,
  "simulated": true
}
```

`stream` is resolved from the caller's identity, exactly as it is on the WebSocket. A
DELAYED caller gets the snapshot as of 15 minutes ago and `snapshotAge` (milliseconds)
describes freshness relative to *that* stream, not to live time.

### `GET /health`

`200 {"status":"healthy"}` — liveness only, no market data.

---

## 3. WebSocket — `/ws/market-data`

One connection per client, carrying every symbol that client subscribes to. Clients must
not open a socket per symbol.

### 3.1 Authentication

The JWT is presented **before** any market data flows. Two accepted forms:

```text
Authorization: Bearer <jwt>          preferred where the client can set headers
?access_token=<jwt>                  browsers, which cannot set headers on WebSocket
```

The gateway validates the token, derives `userId` server-side, resolves entitlement, and
sends `connected` (§3.3). An invalid or expired token is closed with code `4401` before
any tick is sent. A token that expires mid-session is closed with `4403`; the client
re-authenticates and resubscribes.

### 3.2 Client → server

Every message has a `type`. `requestId` is optional, echoed back when present.

```json
{ "type": "subscribe",   "symbols": ["COMI", "CIB"], "requestId": "r1" }
{ "type": "unsubscribe", "symbols": ["CIB"],         "requestId": "r2" }
{ "type": "ping",        "requestId": "r3" }
```

There is deliberately **no** `stream`, `tier`, `delay` or `userId` field. Adding one to
this contract is a security defect, not a feature (FR-6).

### 3.3 Server → client

**`connected`** — first frame after a successful handshake.

```json
{ "v": 1, "type": "connected", "userId": "user-001", "stream": "LIVE",
  "sessionId": "b3f1…", "heartbeatIntervalMs": 15000, "serverTime": "2026-09-12T10:31:00.000Z" }
```

**`subscribed` / `unsubscribed`** — acknowledgement, naming the resolved stream.

```json
{ "v": 1, "type": "subscribed", "requestId": "r1", "stream": "LIVE",
  "accepted": ["COMI", "CIB"], "rejected": [] }
```

**`tick`** — the market-data event. This is the hot message; it stays small.

```json
{ "v": 1, "type": "tick", "s": "COMI", "p": "85.42", "q": 500,
  "k": "TRADE", "t": "2026-09-12T10:31:04.881Z", "id": "evt-000000000216637",
  "st": "LIVE" }
```

| Field | Meaning |
|---|---|
| `s` | symbol |
| `p` | price, decimal string |
| `q` | quantity |
| `k` | kind — `TRADE`, `BID`, `ASK` |
| `t` | `exchangeTimestamp`, preserved from the exchange (FR-4) |
| `id` | `eventId`, stable across live and delayed delivery |
| `st` | stream — `LIVE` or `DELAYED` |

Short keys are intentional: at fan-out volumes the envelope is a meaningful share of the
bytes. Every other message type uses long, readable names because none of them are hot.

**`snapshot`** — sent unprompted after a resubscribe so a reconnecting client can repaint
without a REST round-trip. Same body as `GET /symbols/{symbol}/snapshot`, wrapped with
`"type": "snapshot"`.

**`heartbeat`** — `{ "v": 1, "type": "heartbeat", "serverTime": "…" }` every
`heartbeatIntervalMs`. A client that misses two consecutive heartbeats treats the
connection as dead and reconnects.

**`error`** — `{ "v": 1, "type": "error", "code": "…", "message": "…", "requestId": "…" }`.

| Code | Meaning | Client action |
|---|---|---|
| `UNKNOWN_SYMBOL` | not in the universe | drop it from the watchlist |
| `SUBSCRIPTION_LIMIT` | too many symbols | unsubscribe something first |
| `NOT_ENTITLED` | no market-data entitlement at all | show the upgrade path |
| `RATE_LIMITED` | too many control messages | back off |
| `INTERNAL` | server fault | reconnect with backoff |

**`entitlementChanged`** — the server moved this user between streams (FR-6.2).

```json
{ "v": 1, "type": "entitlementChanged", "stream": "LIVE",
  "resubscribeRequired": false, "effectiveFrom": "2026-09-12T10:35:00.000Z" }
```

The client must re-render its stream badge and discard any buffered ticks from the old
stream rather than mixing the two on one chart — mixing LIVE and DELAYED data in one
view is the correctness failure the whole system exists to prevent.

### 3.4 Close codes

| Code | Meaning |
|---|---|
| `1000` | normal |
| `4401` | unauthenticated / invalid token |
| `4403` | token expired mid-session |
| `4408` | heartbeat timeout, server side |
| `4429` | slow consumer — the client could not keep up and was disconnected (NFR-3) |

`4429` is the client-facing half of the mock exchange's own slow-consumer policy
([ADR 002](../decisions/002-slow-consumer-policy.md)). A client that receives it should
reconnect with backoff and consider subscribing to fewer symbols.

---

## 4. Client lifecycle

```text
CONNECT ──▶ authenticate ──▶ connected(stream) ──▶ subscribe ──▶ snapshot ──▶ ticks
   ▲                                                                            │
   └────── backoff + jitter ◀── disconnected ◀───────────────────────────────────┘
```

Reconnect backoff: 500 ms, doubling to a 30 s ceiling, with ±20% jitter so a gateway
restart does not produce a synchronised reconnect storm (Phase 14).

---

## 5. What a Phase 3 implementation must not assume

- **That the simulated source's numbers are meaningful.** They are shaped like the mock
  exchange's tape; they are not a market.
- **That latency is real.** Until the client talks to a gateway across a network, any
  displayed latency is same-process arithmetic. Label it as such.
- **That 15 minutes of delay can be demonstrated in the browser.** The simulated source
  fakes DELAYED by holding a short configurable offset (default 15 s, not 15 minutes) so
  the two-customer difference is visible in a demo. This is a **simulation artifact and
  the one place the Phase 3 client knowingly departs from the contract** — the real
  delay is 15 minutes and is produced server-side by the delayed processor on the Kafka
  DELAYED path. The
  offset must be labelled on screen wherever it is shown.
