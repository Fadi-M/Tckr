# REQUIREMENTS

> **Phase 1 output.** This document holds *what Tckr must do and how well*.
> [`MASTER CONTEXT.md`](MASTER%20CONTEXT.md) holds *why and how* — the architecture, the
> trade-offs and the 18-phase plan. Where a question is "is this behaviour required?",
> this document answers it; where it is "why did we build it that way?", the master
> context does.
>
> Everything here was extracted from the master context, which was the requirements'
> original home. Nothing was added to it in the move except the requirement IDs, §8's
> open questions (each sourced from a deferral the master context already states), and
> the notes marked *Note:*.
>
> Current implementation status against these requirements is **not** recorded here —
> it lives in [`../STATE.md`](../STATE.md), so this document does not rot as phases land.

---

## 1. Scope

Tckr is a **market-data distribution platform**. It is not a complete brokerage.

```text
Exchange Market Data
        ↓
Feed Ingestion
        ↓
Normalization
        ↓
Durable Event Stream
        ↓
Live + Delayed Market Data
        ↓
Subscription Routing
        ↓
WebSocket Gateways
        ↓
Clients
```

Out of scope: order execution, OMS, brokerage accounting, portfolio management,
settlement, regulatory reporting, payments, complete identity infrastructure, and
exchange order-entry protocols. These may be discussed as adjacent systems.

---

## 2. Functional requirements

### FR-1 — One logical exchange connection

There is exactly one logical connection between the platform and the exchange.

```text
                    Stock Exchange
                         │
                 Single Market Feed
                         │
                         ▼
                 Feed Ingestion
```

The feed carries approximately **25,000 events/sec covering all symbols**. The entire
feed is ingested once. The system must **not** open one exchange connection per symbol
or per customer.

### FR-2 — Normalized internal event model

The exchange-specific protocol must be isolated from the rest of the system. The
ingestion/parser layer converts exchange messages into an internal normalized event
that does not depend on the exchange's wire format.

```json
{
  "eventId": "evt-12345",
  "symbol": "COMI",
  "eventType": "TRADE",
  "price": 85.10,
  "quantity": 500,
  "exchangeTimestamp": "2026-08-08T10:00:00.100Z"
}
```

Required fields: `eventId`, `symbol`, `eventType`, `price`, `quantity`,
`exchangeTimestamp`.

*Note:* the example above renders `price` as a JSON decimal because that is how the
master context specified it. The project convention is that prices and quantities are
never `float`/`double` anywhere — the mock exchange's wire format carries fixed-point
`long` with 4 implied decimals ([ADR 001](decisions/001-mock-exchange-wire-protocol.md)).
Whichever serialization the normalized event finally uses must preserve exact decimal
values. This is unresolved for the internal model; see §8.

### FR-3 — Subscribed users receive live market data

```text
Exchange → Ingestion → Kafka RAW → Live Broadcaster → Gateway → Subscribed client
```

The live path must minimize additional latency (see NFR-2).

### FR-4 — Non-subscribed users receive the same events, 15 minutes later

This is explicitly a **delayed tick stream**.

```text
Exchange event:      10:00:00.100   COMI = 85.10
Delayed stream:      10:15:00.100   COMI = 85.10
```

The delayed event retains its original `eventId`, `exchangeTimestamp`, `symbol`,
`price`, `quantity` and event type. **Only its customer-facing availability is
delayed.**

It is *not* "the current price as of 15 minutes ago", and it is *not* "send the client
live data and have the client wait 15 minutes before displaying it".

**FR-4.1** — The delayed stream is generated **once** and distributed to all entitled
users. Per-client delay queues are prohibited (the 15-minute window holds ~22.5M events;
see §6).

**FR-4.2** — The delayed stream must be durable, replayable, appropriately ordered,
recoverable, and independently scalable. An unbounded in-memory queue must not be the
source of truth.

**FR-4.3** — The delay is measured from **exchange time**, not ingestion time. An event
stamped `10:00:00` that arrives at `10:00:05` releases at `10:15:00`, not `10:15:05`.

### FR-5 — Authentication, entitlement and subscription are three separate concerns

| Concern | Question it answers | Example |
|---|---|---|
| **Authentication** | Who is this user? | JWT → user 12345 |
| **Entitlement / authorization** | Which market-data stream may this user receive? | user 12345 → LIVE; user 67890 → DELAYED |
| **Subscription** | Which symbols does this user want? | user 12345 → COMI, CIB, ORAS |

These must not be conflated. The entitlement source of truth must be kept separate from
Redis routing state.

### FR-6 — The client never chooses its own entitlement

A client sending `{"stream": "LIVE", "symbol": "COMI"}` must **not** thereby receive
live data.

```text
Client → JWT → Gateway → Authenticate user → Resolve entitlement → Determine stream
```

The server decides: a LIVE user's subscription resolves to `LIVE:COMI`, a DELAYED
user's to `DELAYED:COMI`. This is an authorization boundary, and it is the single most
security-sensitive requirement in the system.

**FR-6.1** — Entitlement is re-resolved server-side on every reconnect.

**FR-6.2** — An entitlement change (for example, a user purchasing a subscription) must
eventually move that user's existing subscriptions from `DELAYED:<symbol>` to
`LIVE:<symbol>` without requiring a manual reconnect.

### FR-7 — A customer-facing market watch client

The platform must be demonstrable to a person, not only to a benchmark. The client
requirement is:

- A **list of instruments** over the exchange's symbol universe, showing price, change
  and activity, searchable and sortable.
- A **per-symbol detail view** charting **price against time**, updating in real time as
  ticks arrive.
- The stream the viewer is receiving — LIVE or DELAYED — stated on screen, from the
  server's assignment (FR-6), never from client state.
- Connection status, reconnect, and snapshot-then-resume (DS-3).

**FR-7.1 — One client-facing contract.** Clients consume a single documented contract
— [`phase-3-web-client/client-contract.md`](phase-3-web-client/client-contract.md) —
over REST for the universe and snapshots, and one WebSocket per client for the stream.
A client must not open a connection per symbol, and no client-facing message may expose
the exchange's wire format.

**FR-7.2 — Prices cross the client boundary as decimal strings**, never as JSON numbers,
for the same reason they are fixed-point on the exchange wire (FR-2).

**FR-7.3 — The data source is replaceable.** The client obtains market data through one
interface, so a simulated source and the real gateway are interchangeable by
configuration. This is what makes the client buildable before the gateway exists.

**FR-7.4 — Simulated data is labelled as simulated,** on every screen, for as long as
the data is not coming from the real pipeline. The symbol universe is fictional and its
own reference file says so; presenting it as real market data would be a fabrication.

---

---

## 3. Delivery semantics

### DS-1 — Per-symbol ordering

Ordering within a symbol must be preserved end to end. If the exchange emits:

```text
10:00:00.001 COMI = 85.10
10:00:00.002 COMI = 85.12
10:00:00.003 COMI = 85.09
```

the delayed stream must deliver:

```text
10:15:00.001 COMI = 85.10
10:15:00.002 COMI = 85.12
10:15:00.003 COMI = 85.09
```

Global ordering across all symbols is **not** required. Partitioning by symbol gives
ordering within a symbol while letting different symbols be processed in parallel.

### DS-2 — Late events

The system needs an explicit, documented policy for events whose `exchangeTimestamp`
and ingestion timestamp differ enough that the release time has already passed.

For the demo the policy is:

```text
if now >= releaseAt:
    publish as soon as possible
```

The exact semantics must be confirmed with the real product owner in a production
implementation (see §8).

### DS-3 — Recovery does not require replaying every tick

For a live-price display, a client reconnecting after a short outage does not need every
missed tick. It may receive the current snapshot and then resume the stream:

```text
CURRENT SNAPSHOT  COMI = 85.20   →   resume live updates
```

This applies to the **live display** path only. The delayed stream's exact event
sequence is part of the product requirement, and the authoritative event stream remains
available in full for internal consumers that require durable, complete processing.

---

## 4. Non-functional requirements

### NFR-1 — Throughput

Sustain **~25,000 market-data events/sec** from a single exchange connection, covering
all symbols, without slowing ingestion. Achieved rate must be measured, not assumed, and
reported as achieved-vs-target.

### NFR-2 — Latency

The live path must add minimal latency over `Exchange → Ingestion → Kafka → Live
Broadcaster → Gateway → Client`.

*Note:* the master context sets no numeric latency target — "low latency" is stated as a
priority, not a threshold. This is an open item; see §8.

### NFR-3 — Backpressure and slow clients

A slow WebSocket client must never block the gateway or affect other clients.

```text
Gateway
  ├── Fast client → send
  ├── Fast client → send
  └── Slow client → bounded buffer / disconnect policy
```

Explicit policies are required for: maximum per-connection buffer, slow-consumer
detection, disconnect thresholds, backpressure metrics, and recovery/reconnect.

**NFR-3.1 — Latest-value-wins.** For a live-price display, a client that cannot keep up
may be served coalesced updates: the newest price for a symbol supersedes an older
undelivered one, rather than queueing every tick. This applies to the *display* path
only — it must never be applied to the delayed tick stream, whose exact event sequence
is the product (FR-4).

### NFR-4 — Isolation between failure domains

- A slow client must not affect exchange ingestion.
- A gateway failure must not stop the market feed.
- A delayed-processing problem must not stop live market data.

### NFR-5 — Horizontal scalability

The system scales by adding Kafka consumers, broadcasters and gateways — **never** by
adding exchange connections. It must not assume uniform symbol distribution: a single
hot symbol may carry a disproportionate share of subscribers (500,000 users on one
symbol while another has 100).

### NFR-6 — Recoverability

Critical state must be recoverable from durable systems. Specifically: routing metadata
is persisted, WebSocket connections are **not**, and gateway state is reconstructable
through client reconnect and resubscription rather than durable.

### NFR-7 — Observability

The system must be operable: structured logging, health checks, metrics and dashboards
covering at minimum ingest rate, consumer lag, active connections and subscriptions,
fan-out volume, dropped updates, slow clients, and end-to-end latency.

---

## 5. Priority order when requirements conflict

1. **Correctness** — a financial system must never silently mix LIVE and DELAYED data.
2. **Isolation** — see NFR-4.
3. **Scalability** — see NFR-5.
4. **Low latency** — see NFR-2.
5. **Recoverability** — see NFR-6.

Correctness outranks all of the others: a fast, cheap, scalable system that serves live
prices to a non-entitled user has failed.

---

## 6. Capacity and sizing

Derived from the 25,000 events/sec starting assumption.

| Window | Events |
|---|---:|
| Per second | 25,000 |
| Per minute | 1,500,000 |
| Per hour | 90,000,000 |
| Per day | 2,160,000,000 |
| **15-minute delay window** | **22,500,000** |

At an assumed ~200 bytes per normalized event:

```text
Steady-state payload:   25,000 × 200   = 5 MB/sec ≈ 40 Mbps
15-minute window:       22.5M × 200    ≈ 4.5 GB
```

Both figures are **payload only**. Real usage is higher because of object overhead,
Kafka record metadata, replication, serialization, indexing, buffers, WebSocket framing,
application overhead, and multiple downstream consumers.

These numbers drive Kafka sizing, partition count, retention, network provisioning,
delayed-stream buffering, load-test targets and persistence decisions. They are
estimates: the actual system must be benchmarked rather than sized from this table.

*Note:* the ~200 bytes/event figure is an estimate for the **normalized internal event**.
The mock exchange's binary wire record is roughly 4.5x smaller (44 bytes) — see
[`phase-2-mock-exchange/wire-protocol.md`](phase-2-mock-exchange/wire-protocol.md).

---

## 7. Acceptance criteria

Tckr is complete when it can demonstrate all of the following. Current status per item
lives in [`../STATE.md`](../STATE.md).

- A mock exchange.
- A single exchange/feed connection.
- Approximately 25K events/sec ingestion target.
- Normalized market-data events.
- Kafka RAW stream.
- Symbol-based partitioning.
- Live broadcaster.
- 15-minute delayed processor.
- Kafka DELAYED stream.
- Delayed broadcaster.
- JWT authentication.
- Server-side LIVE/DELAYED entitlement.
- Symbol subscriptions.
- Multiple .NET WebSocket gateways.
- Redis distributed routing.
- Local in-memory socket fan-out.
- Gateway restart/reconnect.
- Delayed processor recovery.
- Backpressure.
- Observability.
- Load testing.
- A market watch web client: instrument list, per-symbol price-vs-time chart, live
  updates, server-assigned LIVE/DELAYED badge.
- That same client, unchanged apart from configuration, driven by the real pipeline.
- Both customer types shown side by side, visibly out of step.

---

## 8. Open questions

Each of these is a deferral the master context already makes explicit, collected here so
they are not mistaken for settled requirements.

1. **Exact late-event semantics (DS-2).** The demo policy is "publish as soon as
   possible". A production implementation must confirm the intended behaviour with the
   product owner — in particular whether a badly late event should be published at all,
   or dropped as stale.
2. **No numeric latency target (NFR-2).** "Low latency" is a stated priority with no
   threshold attached. A p95/p99 budget for the live path should be set before Phase 17
   load-testing, otherwise the load test has no pass/fail line.
3. **Duplicate delivery.** The master context raises "can an event be duplicated?" as a
   question the design must answer but does not state a requirement. Whether the system
   targets at-least-once or exactly-once delivery to the client, and whether clients must
   be prepared to de-duplicate on `eventId`, is undecided.
4. **Serialization of `price`/`quantity` in the normalized event (FR-2).** Fixed-point
   is settled on the exchange wire; the internal event model's representation is not.
