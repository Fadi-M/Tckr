# MASTER CONTEXT

> **Read this section first.** This is the canonical context for the Tckr project. It explains the interview problem, the assumptions we are making, the architecture we are building, the important trade-offs, and the reasoning behind the implementation phases.

---

## 1. Why We Are Building Tckr

Tckr is a technical demonstration project created to prepare for and support a **Thndr — Tech Lead, Trading Squad** system-design interview.

The purpose is **not** to reproduce Thndr's proprietary architecture or claim that this is how Thndr actually implements market-data distribution.

Instead, Tckr demonstrates how we would approach a realistic version of the interview problem:

- Start from the exchange's single market-data connection.
- Sustain approximately **25,000 market-data events per second**.
- Normalize and distribute those events efficiently.
- Support many concurrent users and WebSocket connections.
- Give subscribed users live market data.
- Give non-subscribed users the same events exactly **15 minutes later**.
- Keep authentication, authorization, routing, and connection state separate.
- Survive gateway/process failures and rolling deployments.
- Scale horizontally without putting Redis or the database in the per-event hot path.
- Preserve ordering and provide durable recovery where required.
- Demonstrate the design with an actual working implementation.

The repository should therefore be both:

1. A working technical project.
2. A concrete artifact that can be discussed during the Thndr interview.

---

# 2. The Original Interview Problem

The core interview scenario is:

> **Design the real-time price-update system between the stock exchange and a Thndr user who wants to look at live updates for a particular stock symbol.**

The interviewer explained that:

- Thndr has **one connection to the exchange**.
- That connection receives approximately **25,000 updates per second**.
- Those updates contain market data for **all symbols**.
- Users are interested in individual symbols.
- There are two customer types:
  - **Subscribed users** receive live updates.
  - **Non-subscribed users** receive updates with a **15-minute delay**.

The problem is therefore not simply:

```text
Exchange → App
```

It is a distributed market-data fan-out problem:

```text
                    ┌──→ User A: COMI
                    │
Exchange → Tckr →───┼──→ User B: CIB
                    │
                    ├──→ User C: COMI
                    │
                    └──→ User D: ORAS
```

while simultaneously enforcing:

```text
Subscribed     → LIVE
Non-subscribed → DELAYED by 15 minutes
```

---

# 3. Thndr Trading Squad Context

The role is **Tech Lead — Trading Squad**.

The job description emphasizes:

- Systems at the core of the trading platform.
- Direct connectivity to exchanges and asset managers.
- In-house OMS and back-office systems.
- High throughput.
- Low latency.
- Correctness.
- Operational excellence.
- Distributed systems.
- C# / .NET.
- SQL Server.
- PostgreSQL.
- Redis.
- RabbitMQ.
- Python.
- Hybrid infrastructure.
- Working with exchanges, regulators, senior engineers, and leadership.

This means the interviewer is unlikely to care only about whether we can draw:

```text
Kafka → WebSocket
```

They are likely evaluating whether we think like a Tech Lead operating a **high-stakes financial system**.

Our design should therefore explicitly reason about:

- Failure modes.
- Data loss.
- Duplicates.
- Ordering.
- Backpressure.
- Entitlement/security.
- Scaling.
- Hot symbols.
- Slow clients.
- Reconnection.
- Observability.
- Operational recovery.
- Capacity planning.

---

# 4. What Exactly Are We Building?

Tckr is a **market-data distribution platform**.

It is NOT a complete brokerage.

The scope is:

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

We are NOT attempting to fully implement:

- Order execution.
- OMS.
- Brokerage accounting.
- Portfolio management.
- Settlement.
- Regulatory reporting.
- Payments.
- Complete identity infrastructure.
- Exchange order-entry protocols.

Those can be mentioned as adjacent systems, but market-data distribution is the core problem.

---

# 5. Core Requirements

## 5.1 Exchange Connectivity

There is exactly one logical connection between the platform and the exchange:

```text
                    Stock Exchange
                         │
                         │
                 Single Market Feed
                         │
                         ▼
                 Feed Ingestion
```

The exchange sends approximately:

```text
25,000 events / second
```

covering all symbols.

This means we must ingest the entire feed once and avoid creating one exchange connection per symbol or per customer.

---

# 6. Market-Data Event Model

The exchange-specific protocol should be isolated from the rest of the system.

The ingestion/parser layer converts exchange messages into an internal normalized event.

Example:

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

Important fields include:

- `eventId`
- `symbol`
- `eventType`
- `price`
- `quantity`
- `exchangeTimestamp`

The internal event should not depend on the exchange's wire format.

---

# 7. Two Customer Types

This is one of the most important requirements.

## Subscribed users

Subscribed users receive:

```text
LIVE MARKET DATA
```

The desired path is:

```text
Exchange
   ↓
Ingestion
   ↓
Kafka RAW
   ↓
Live Broadcaster
   ↓
WebSocket Gateway
   ↓
Subscribed Client
```

The live path should minimize additional latency.

---

## Non-subscribed users

Non-subscribed users receive:

```text
THE SAME MARKET EVENTS
15 MINUTES LATER
```

This is explicitly a **delayed tick stream**.

It is NOT:

```text
"show me the current price minus 15 minutes"
```

and it is NOT simply:

```text
"send live data to the client and wait 15 minutes before displaying it"
```

The intended semantics are:

```text
Exchange event:

10:00:00.100
COMI = 85.10

Delayed stream:

10:15:00.100
COMI = 85.10
```

The event retains its original:

```text
eventId
exchangeTimestamp
symbol
price
quantity
event type
```

Only its customer-facing availability is delayed.

---

# 8. Authentication vs Entitlement vs Subscription

These are three different concepts.

## Authentication

Answers:

> Who is this user?

Example:

```text
JWT
 ↓
User ID = 12345
```

## Entitlement / Authorization

Answers:

> What market-data stream is this user allowed to receive?

```text
User 12345
     ↓
LIVE
```

or:

```text
User 67890
     ↓
DELAYED
```

## Subscription

Answers:

> Which symbols does this user want?

```text
User 12345
   │
   ├── LIVE
   │
   └── COMI, CIB, ORAS
```

These concerns must not be conflated.

---

# 9. The Client Must Never Choose Its Entitlement

A malicious client must not be able to send:

```json
{
  "stream": "LIVE",
  "symbol": "COMI"
}
```

and receive live data.

Instead:

```text
Client
   ↓
JWT
   ↓
Gateway
   ↓
Authenticate user
   ↓
Resolve entitlement
   ↓
Determine stream
```

The server decides:

```text
LIVE user
   → LIVE:COMI

DELAYED user
   → DELAYED:COMI
```

This is an authorization boundary.

---

# 10. Proposed High-Level Architecture

The current architecture is:

```text
                              STOCK EXCHANGE
                                   │
                              Single Feed
                                   │
                                   ▼
                        ┌────────────────────┐
                        │ Feed Ingestion     │
                        └──────────┬─────────┘
                                   │
                                   ▼
                        ┌────────────────────┐
                        │ Market Data Parser │
                        └──────────┬─────────┘
                                   │
                                   ▼
                              ┌─────────┐
                              │ Kafka   │
                              │  RAW    │
                              └────┬────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
                    ▼                             ▼
          ┌──────────────────┐          ┌────────────────────┐
          │ Live Broadcaster │          │ Delayed Processor  │
          └────────┬─────────┘          └─────────┬──────────┘
                   │                              │
                   │                              │ +15 minutes
                   │                              ▼
                   │                    ┌───────────────────┐
                   │                    │ Kafka DELAYED     │
                   │                    └─────────┬─────────┘
                   │                              │
                   │                              ▼
                   │                    ┌────────────────────┐
                   │                    │ Delayed Broadcaster│
                   │                    └─────────┬──────────┘
                   │                              │
                   └──────────────┬───────────────┘
                                  │
                           Redis Routing
                                  │
                ┌─────────────────┴─────────────────┐
                │                                   │
          LIVE:<symbol>                       DELAYED:<symbol>
                │                                   │
        ┌───────┼────────┐                  ┌───────┼────────┐
        ▼       ▼        ▼                  ▼       ▼        ▼
     Gateway Gateway  Gateway             Gateway Gateway  Gateway
        │       │        │                  │       │        │
        ▼       ▼        ▼                  ▼       ▼        ▼
     Clients Clients  Clients             Clients Clients  Clients
```

Persistence/snapshot storage is an independent consumer of the authoritative stream.

---

# 11. Why Kafka?

Kafka is the durable internal boundary between exchange ingestion and downstream consumers.

Without a durable boundary:

```text
Exchange
   ↓
Ingestion
   ↓
WebSocket Gateway
```

a downstream failure could interfere with exchange ingestion.

Instead:

```text
Exchange
   ↓
Ingestion
   ↓
Kafka
   ↓
Multiple independent consumers
```

Kafka gives us:

- Durable buffering.
- Consumer isolation.
- Replay.
- Consumer offsets.
- Partitioning.
- Horizontal scaling.
- Failure recovery.

The raw Kafka stream is the authoritative internal market-data event stream.

---

# 12. Why Two Kafka/Data Paths?

The same raw market event must support two customer products:

```text
                    Kafka RAW
                       │
             ┌─────────┴─────────┐
             │                   │
             ▼                   ▼
       Live Broadcaster    Delayed Processor
             │                   │
             │                   │ +15 minutes
             │                   ▼
             │             Kafka DELAYED
             │                   │
             │                   ▼
             │            Delayed Broadcaster
             │                   │
             └─────────┬─────────┘
                       │
                 WebSocket Layer
```

This isolates:

```text
LIVE
```

from:

```text
DELAYED
```

and lets each path scale independently.

---

# 13. Why We Do Not Delay Per Client

At 25K events/sec:

```text
25,000 × 900
=
22,500,000 events
```

exist in a 15-minute window.

If each event averages 200 bytes:

```text
22.5M × 200
≈ 4.5 GB
```

of raw payload exists before accounting for:

- Object overhead.
- Kafka metadata.
- Replication.
- Serialization.
- Indexing.
- Buffers.
- Application overhead.

Therefore, this is a bad design:

```text
Client A
  → delay queue

Client B
  → delay queue

Client C
  → delay queue

...
```

Instead:

```text
One delayed stream
        ↓
Many consumers
```

The delayed stream is generated once.

---

# 14. Delayed Processor Design

The delayed processor consumes the raw Kafka stream.

For each event:

```text
eventTimestamp = 10:00:00.100

releaseAt =
10:15:00.100
```

The processor releases the event when its scheduled availability time arrives.

The delayed event is then published to:

```text
Kafka DELAYED
```

The delayed stream must be:

- Durable.
- Replayable.
- Ordered appropriately.
- Recoverable.
- Independently scalable.

Do not make an unbounded in-memory queue the source of truth.

---

# 15. Event Ordering

Market data ordering matters.

For a symbol:

```text
10:00:00.001 COMI = 85.10
10:00:00.002 COMI = 85.12
10:00:00.003 COMI = 85.09
```

the delayed stream should preserve:

```text
10:15:00.001 COMI = 85.10
10:15:00.002 COMI = 85.12
10:15:00.003 COMI = 85.09
```

Kafka partitioning should therefore provide ordering for events belonging to the same symbol.

A natural strategy is:

```text
partition key = symbol
```

This gives ordering within a symbol while allowing different symbols to be processed in parallel.

---

# 16. Late Events

We need an explicit policy for events where:

```text
exchangeTimestamp
```

and:

```text
ingestionTimestamp
```

differ.

Example:

```text
Exchange timestamp: 10:00:00
Received by Tckr:  10:00:05
```

If delay is defined relative to exchange time:

```text
releaseAt = 10:15:00
```

not:

```text
releaseAt = 10:15:05
```

If an event arrives after its intended release time, the implementation needs a documented policy.

For the demo, a reasonable policy is:

```text
if now >= releaseAt:
    publish as soon as possible
```

The exact semantics should be explicitly confirmed with the real product owner in a production implementation.

---

# 17. WebSocket Gateway Model

The gateway is a .NET application.

It maintains local in-memory state such as:

```text
Gateway 1

COMI
 ├── Socket A
 ├── Socket B
 └── Socket C

CIB
 ├── Socket D
 └── Socket E
```

This state is optimized for the hot path:

```text
market event
    ↓
gateway
    ↓
local symbol lookup
    ↓
socket writes
```

We do not query Redis for every socket message.

---

# 18. Redis Routing Model

Redis maintains distributed routing metadata.

For example:

```text
LIVE:COMI
    → Gateway-1
    → Gateway-3

DELAYED:COMI
    → Gateway-2
    → Gateway-4
```

The exact Redis data structure can evolve during implementation.

The important architectural rule is:

> Redis answers **which gateways are interested**, not **which WebSocket objects exist**.

The gateway then performs local fan-out.

---

# 19. Why Gateway State Is Not Durable

A WebSocket connection is tied to:

- A client.
- A TCP connection.
- A gateway process.

If the gateway dies:

```text
Gateway
   X
Socket
   X
TCP connection
```

That connection cannot be restored from Redis.

Therefore:

> **Do not try to persist WebSocket connections.**

Instead, make gateway state reconstructable.

---

# 20. Gateway Restart / Deployment Lifecycle

If Gateway 1 restarts:

```text
Gateway 1
   ↓
Process terminates
   ↓
Sockets disappear
```

The client reconnects:

```text
Client
   ↓
Load Balancer
   ↓
Gateway 2
```

Then:

```text
Authenticate
   ↓
Resolve entitlement
   ↓
Resubscribe
   ↓
Rebuild local socket map
   ↓
Register routing metadata
   ↓
Receive snapshot if necessary
   ↓
Continue stream
```

This also supports rolling deployments.

The key principle is:

> **Persist routing metadata, not connections. Make gateway state reconstructable.**

---

# 21. Client Reconnection

The client lifecycle is:

```text
CONNECT
   ↓
AUTHENTICATE
   ↓
RESOLVE ENTITLEMENT
   ↓
SUBSCRIBE
   ↓
RECEIVE MARKET DATA
```

On failure:

```text
DISCONNECTED
   ↓
BACKOFF + JITTER
   ↓
RECONNECT
   ↓
AUTHENTICATE
   ↓
RESUBSCRIBE
   ↓
GET CURRENT SNAPSHOT
   ↓
RESUME LIVE/DELAYED STREAM
```

For a live-price display, we do not need to replay every missed tick after a short disconnect.

The authoritative event stream remains available for systems that do require every event.

---

# 22. Snapshot Recovery

A client reconnecting to a live stream could miss:

```text
85.10
85.12
85.15
85.20
```

during its outage.

For display purposes, it can receive:

```text
CURRENT SNAPSHOT
COMI = 85.20
```

and then continue receiving live updates.

The snapshot therefore provides a fast state-recovery mechanism.

This is different from the delayed tick stream, where the exact delayed event sequence is part of the product requirement.

---

# 23. Hot Symbols

A symbol can have a disproportionate number of subscribers.

For example:

```text
COMI
 ↓
500,000 users
```

while:

```text
XYZ
 ↓
100 users
```

The architecture must therefore avoid assuming uniform distribution.

Potential strategies include:

- Partitioning Kafka by symbol.
- Scaling gateway instances.
- Sharding subscription routing.
- Isolating extremely hot symbols.
- Applying backpressure.
- Avoiding repeated global broadcasts.
- Measuring per-symbol fan-out cost.

This is a later optimization and should be driven by load-test data.

---

# 24. Backpressure

A slow WebSocket client must not block the gateway.

Bad:

```text
Market Event
   ↓
Slow Client
   ↓
Gateway blocked
   ↓
Other clients affected
```

Instead:

```text
Market Event
   ↓
Gateway
   ├── Fast client → send
   ├── Fast client → send
   └── Slow client → bounded buffer / disconnect policy
```

The system needs explicit policies for:

- Maximum per-connection buffer.
- Slow-consumer detection.
- Disconnect thresholds.
- Backpressure metrics.
- Recovery/reconnect.

---

# 25. Authentication Architecture

For the demo:

```text
Client
   ↓
Authentication Service
   ↓
JWT
   ↓
WebSocket Gateway
```

The JWT identifies the user.

The gateway validates the token and builds a `UserContext`:

```text
UserContext
{
    UserId,
    MarketDataTier
}
```

Example:

```text
User 001
    → LIVE

User 002
    → DELAYED
```

The real entitlement source of truth should be separate from Redis.

For Tckr, a mock identity/entitlement service is enough.

---

# 26. Entitlement Changes

Suppose a user starts as:

```text
DELAYED
```

and purchases a subscription.

The system should eventually transition:

```text
DELAYED
   ↓
LIVE
```

A production architecture could publish an entitlement-change event:

```text
Subscription Service
       ↓
Entitlement Changed
       ↓
Gateway
       ↓
Move subscriptions:
DELAYED:COMI
       ↓
LIVE:COMI
```

The exact implementation can be simplified for the demo.

---

# 27. Important Capacity Numbers

Starting assumptions:

```text
25,000 events/sec
```

Per minute:

```text
25,000 × 60
=
1.5M events/minute
```

Per hour:

```text
25,000 × 3,600
=
90M events/hour
```

Per day:

```text
25,000 × 86,400
=
2.16B events/day
```

15-minute window:

```text
25,000 × 900
=
22.5M events
```

These calculations drive:

- Kafka sizing.
- Partition count.
- Retention.
- Network throughput.
- Delayed-stream buffering.
- Load-testing targets.
- Persistence decisions.

---

# 28. Approximate Network Throughput

If an average normalized event is 200 bytes:

```text
25,000 × 200
=
5,000,000 bytes/sec
≈ 5 MB/sec
≈ 40 Mbps
```

This is only the payload estimate.

Real throughput is higher because of:

- Protocol overhead.
- Kafka record overhead.
- Replication.
- Serialization.
- WebSocket framing.
- Multiple downstream consumers.

The actual system should be benchmarked rather than relying on estimates.

---

# 29. What We Are Optimizing For

The primary optimization priorities are:

### 1. Correctness

A financial system must not silently mix:

```text
LIVE
```

and:

```text
DELAYED
```

data.

### 2. Isolation

A slow client should not affect exchange ingestion.

A gateway failure should not stop the market feed.

A delayed-processing problem should not stop live market data.

### 3. Scalability

The system must scale by adding:

```text
Kafka consumers
Broadcasters
Gateways
```

rather than creating additional exchange connections.

### 4. Low latency

The live path should be short:

```text
Exchange
→ Ingestion
→ Kafka
→ Live Broadcaster
→ Gateway
→ Client
```

### 5. Recoverability

Critical state should be recoverable from durable systems.

---

# 30. What We Explicitly Do NOT Do

We should avoid these designs unless requirements force us to reconsider them.

## Do not create one exchange connection per symbol

Bad:

```text
COMI → exchange connection
CIB  → exchange connection
ORAS → exchange connection
```

We have one authoritative exchange feed.

---

## Do not send every market event to every gateway

Bad:

```text
Every event
   ↓
Every gateway
```

This creates unnecessary network traffic.

Use symbol-aware routing.

---

## Do not query Redis for every socket

Bad:

```text
25K events/sec
   ↓
Redis lookup
   ↓
each socket
```

Use Redis for gateway-level routing and local memory for socket-level fan-out.

---

## Do not store WebSocket objects in Redis

WebSockets are process-local.

Redis stores metadata only.

---

## Do not delay data separately for each client

Generate one delayed stream.

---

## Do not trust client-provided entitlement

The server determines:

```text
LIVE
```

or:

```text
DELAYED
```

---

# 31. Core Data-Flow Contracts

## Live

```text
Exchange
   ↓
Kafka RAW
   ↓
Live Consumer
   ↓
Live Broadcaster
   ↓
LIVE:<symbol>
   ↓
Gateway
   ↓
Local sockets
   ↓
LIVE user
```

## Delayed

```text
Exchange
   ↓
Kafka RAW
   ↓
Delayed Processor
   ↓
15-minute delay
   ↓
Kafka DELAYED
   ↓
Delayed Broadcaster
   ↓
DELAYED:<symbol>
   ↓
Gateway
   ↓
Local sockets
   ↓
DELAYED user
```

## Authentication

```text
Client
   ↓
JWT
   ↓
Gateway
   ↓
User identity
   ↓
Entitlement
```

## Recovery

```text
Gateway failure
   ↓
Client reconnect
   ↓
Authenticate
   ↓
Resolve entitlement
   ↓
Resubscribe
   ↓
Rebuild local state
   ↓
Resume stream
```

---

# 32. Interview Questions We Should Be Ready For

The implementation should prepare us to answer:

### Architecture

- Why Kafka?
- Why not RabbitMQ?
- Why not Redis Pub/Sub?
- Why not send directly from ingestion to WebSockets?
- Why separate live and delayed paths?
- Why multiple gateways?
- Where does state live?

### Scaling

- How do we handle 25K events/sec?
- How do we scale Kafka consumers?
- How do we scale WebSocket gateways?
- What happens with a hot symbol?
- How many connections can one gateway handle?
- How do we calculate capacity?

### Correctness

- How do we preserve ordering?
- Can an event be duplicated?
- What happens if an event is lost?
- What is the source of truth?
- How do we handle late events?
- What exactly does "15 minutes delayed" mean?

### Failure

- What if Kafka is unavailable?
- What if the broadcaster crashes?
- What if a gateway crashes?
- What if Redis fails?
- What if a client disconnects?
- What if the delayed processor falls behind?
- What if the system is deployed while users are connected?

### Security

- How does the server know who the user is?
- How do we prevent a non-subscribed user from receiving live data?
- Where is entitlement stored?
- What happens when a user upgrades?
- What happens when a token expires?

### Performance

- Where is the hot path?
- What is the expected latency?
- Is Redis in the hot path?
- How much data exists in the 15-minute window?
- What happens when clients are slow?

---

# 33. The Core Interview Narrative

The simplest way to explain the architecture verbally is:

> **"I would treat the exchange connection as an ingestion boundary. We receive the entire 25K events/sec feed once, parse it into a normalized event model, and publish it to Kafka so downstream consumers are isolated from the exchange connection. From the raw stream, I create two customer-facing paths: a low-latency live path for entitled subscribers and a durable delayed path that releases the same events 15 minutes later for non-subscribers.**
>
> **For client delivery, I'd use horizontally scalable .NET WebSocket gateways. Authentication identifies the user, and server-side authorization determines whether that user belongs to the LIVE or DELAYED stream. Redis stores distributed symbol-to-gateway routing metadata, while each gateway keeps its actual socket mappings in memory.**
>
> **If a gateway dies, I don't try to restore its sockets. Clients reconnect, authenticate, resolve their entitlement, resubscribe, and rebuild the gateway's local state. For live display recovery, we can provide a current snapshot before resuming the stream.**
>
> **The important separation is that exchange ingestion, live distribution, delayed processing, and client delivery can fail and scale independently."**

This is the core story that the implementation should prove.

---

# 34. Definition of Success

Tckr is complete when we can demonstrate:

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
- Real demo clients showing both customer types.

---

# 35. Implementation Philosophy

Build the system incrementally.

Do not start with the entire distributed architecture.

Prove each difficult property independently:

```text
Can we ingest 25K/sec?
        ↓
Can we publish reliably to Kafka?
        ↓
Can we preserve symbol ordering?
        ↓
Can we delay events 15 minutes?
        ↓
Can we authenticate users?
        ↓
Can we enforce LIVE vs DELAYED?
        ↓
Can we route subscriptions?
        ↓
Can gateways fan out efficiently?
        ↓
Can gateways restart safely?
        ↓
Can the entire system scale?
```

Every phase should produce something demonstrable.

---

# 36. Final Mental Model

Keep this diagram in mind throughout the project:

```text
                         STOCK EXCHANGE
                              │
                     One market-data feed
                              │
                              ▼
                    ┌──────────────────┐
                    │ Feed Ingestion   │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ Parser / Normalize│
                    └────────┬─────────┘
                             │
                             ▼
                         KAFKA RAW
                             │
                 ┌───────────┴───────────┐
                 │                       │
                 ▼                       ▼
          LIVE BROADCASTER        DELAYED PROCESSOR
                 │                       │
                 │                       │ +15 minutes
                 │                       ▼
                 │                  KAFKA DELAYED
                 │                       │
                 │                       ▼
                 │                DELAYED BROADCASTER
                 │                       │
                 └───────────┬───────────┘
                             │
                       REDIS ROUTING
                             │
              ┌──────────────┴──────────────┐
              │                             │
         LIVE:<symbol>                 DELAYED:<symbol>
              │                             │
       ┌──────┼──────┐               ┌──────┼──────┐
       ▼      ▼      ▼               ▼      ▼      ▼
      GW1    GW2    GWN             GW1    GW2    GWN
       │      │      │               │      │      │
       └──────┴──────┘               └──────┴──────┘
              │                             │
       LIVE SUBSCRIBERS              NON-SUBSCRIBERS
```

Authentication/authorization sits at the gateway boundary:

```text
Client
   ↓
JWT
   ↓
Gateway
   ↓
User identity
   ↓
Entitlement
   ├── LIVE
   └── DELAYED
```

And the most important architectural rule is:

> **Ingest once, persist the authoritative event stream, create live and delayed products independently, route by symbol and entitlement, fan out locally at the gateway, and make all ephemeral gateway state reconstructable.**

---

# Tckr — Implementation Plan

## Phase 1 — Define the Problem & Requirements

Document the interview scenario and establish measurable requirements.

- 25K market updates/sec
- Single exchange connection
- Multiple symbols
- Symbol-based subscriptions
- Real-time delivery
- Low latency
- Latest-value-wins semantics
- Fault tolerance
- Horizontal scalability
- Observability

**Output:** `requirements.md`

---

## Phase 2 — Build the Mock Exchange

Simulate the stock exchange.

- Generate realistic symbols
- Generate price/volume updates
- Configurable update rate
- Single streaming connection
- Target 25K updates/sec
- Simulate market-open traffic patterns

**Output:** `MockExchange`

---

## Phase 3 — Build Market Data Ingestion

Implement the single connection between Tckr and the exchange.

```text
Exchange → Ingestion
```

- Connect
- Receive
- Parse
- Validate
- Normalize
- Reconnect
- Measure throughput

Initially keep it simple—no Kafka or Redis.

**Output:** `MarketData.Ingestion`

---

## Phase 4 — Benchmark Ingestion

Prove the ingestion layer can handle the target load.

Measure:

- Updates/sec
- P50/P95/P99 latency
- CPU
- Memory
- GC
- Dropped messages

**Target:** Sustain 25K updates/sec.

**Output:** Initial benchmark results.

---

## Phase 5 — Introduce Kafka

Decouple ingestion from downstream processing.

```text
Exchange
   ↓
Ingestion
   ↓
Kafka
   ↓
Consumers
```

- Publish market updates
- Configure partitions
- Partition by symbol
- Consumer groups
- Measure consumer lag
- Test producer/consumer failure

This creates a critical architectural boundary:

> The exchange connection must not depend on the health or speed of WebSocket clients.

**Output:** Durable streaming pipeline.

---

## Phase 6 — Partition Market Data

Optimize Kafka for the market-data workload.

Explore:

- Partitioning by symbol
- Ordering guarantees
- Hot symbols
- Partition distribution
- Consumer scaling

Document why **per-symbol ordering** is more important than global ordering.

**Output:** Partitioning strategy + architecture decision record.

---

## Phase 7 — Build Authentication & Market-Data Entitlements

Introduce authentication and server-side authorization before building subscription routing.

Tckr has two market-data customer tiers:

```text
LIVE      → subscribed users → real-time market updates
DELAYED   → non-subscribed users → 15-minute delayed updates
```

The client must never choose its own market-data tier.

Implement a simple authentication flow for the demo:

```text
Client
   ↓
Authentication Service
   ↓
JWT / access token
   ↓
WebSocket Gateway
   ↓
Authentication + entitlement
   ↓
UserContext
```

Example:

```text
UserContext
{
    UserId: "user-001",
    MarketDataTier: LIVE
}
```

Requirements:

- Authenticate WebSocket connections.
- Validate JWT/access tokens at the gateway.
- Derive `UserId` server-side.
- Resolve the user's market-data entitlement server-side.
- Never trust a client-provided `tier`, `stream`, or `userId`.
- Support entitlement changes such as upgrading from DELAYED to LIVE.
- Revalidate entitlement after reconnect.
- Keep the entitlement source of truth separate from Redis routing state.

For the demo, a mock identity/entitlement service is sufficient.

**Output:** Authenticated WebSocket connections with server-controlled LIVE/DELAYED market-data entitlements.

---

## Phase 8 — Build the Distributed Subscription Registry


Support multiple WebSocket gateways while keeping socket fan-out local to each gateway.

The subscription/control plane is separate from the market-data data plane.

When a client subscribes:

```text
Client
   ↓
WebSocket Gateway
   ↓
Local subscription map
   ↓
Redis distributed registry
```

Maintain two levels of state:

### Redis: symbol → gateways

```text
COMI → {Gateway-1, Gateway-3}
CIB  → {Gateway-2}
```

### Gateway memory: symbol → local sockets

```text
Gateway-1

COMI → {Socket-123, Socket-456}
CIB  → {Socket-789}
```

Implement:

- Subscribe
- Unsubscribe
- Connection tracking
- Symbol → gateway registry in Redis
- Symbol → local socket mapping in gateway memory
- Gateway registration/heartbeat
- TTL/expiry for stale gateway registrations
- Cleanup when a gateway has no subscribers for a symbol

The Broadcaster should use Redis to determine **which gateways** need an update, not which individual sockets need it.

**Output:** Horizontally scalable distributed subscription registry.
## Phase 9 — Build the WebSocket Gateway Cluster

Create the scalable client connection layer.

```text
Clients
   ↕
WebSocket Gateway Cluster
```

Each gateway owns its connected sockets and maintains local subscription state in memory.

Implement:

- WebSocket connections
- Authentication
- Subscribe/unsubscribe
- Connection lifecycle
- Heartbeats
- Disconnect detection
- Local symbol → socket mapping
- Gateway registration in Redis
- Gateway heartbeat/TTL
- Client reconnection
- Resubscription

The gateway should enforce entitlement before registering a subscription.

For example:

```text
User A → LIVE
SUBSCRIBE COMI
    ↓
LIVE:COMI

User B → DELAYED
SUBSCRIBE COMI
    ↓
DELAYED:COMI
```

The client never specifies which stream to use.

The gateway should be responsible for the final local fan-out:

```text
Gateway-1
   │
   ├── COMI → Socket-123
   ├── COMI → Socket-456
   └── CIB  → Socket-789
```

**Output:** Horizontally scalable WebSocket gateway cluster.
## Phase 10 — Implement Real-Time Fan-Out

Connect the complete market-data pipeline using the distributed subscription registry.

```text
Exchange
   ↓
Ingestion
   ↓
Parser
   ↓
Kafka
   ↓
Market Data Broadcaster
   ↓
Redis: symbol → gateways
   ↓
WebSocket Gateways
   ↓
Local subscription map
   ↓
WebSockets
   ↓
Clients
```

For an update such as:

```text
COMI = 85.42
```

the Broadcaster:

1. Consumes the update from Kafka.
2. Determines the symbol.
3. Looks up subscribed gateways in Redis.
4. Sends the update only to those gateways.
5. Each gateway looks up its local COMI subscribers.
6. The gateway fans the update out to those local sockets.

Do **not** use Redis for individual socket writes.

This creates two levels of fan-out:

```text
Market update
     ↓
Gateway-level fan-out
     ↓
Socket-level local fan-out
```

This is the **core interview problem**.

**Output:** End-to-end horizontally scalable real-time price delivery.
## Phase 11 — Handle Slow Clients

Solve backpressure.

Example:

```text
COMI → 200 updates/sec
Client → can process 30/sec
```

Don't allow the client's queue to grow indefinitely.

Implement:

- Bounded queues
- Backpressure
- Latest-value-wins
- Update coalescing
- Slow-client detection
- Client disconnection policy

**Output:** Resilient fan-out mechanism.

---

## Phase 12 — Add Current Price Snapshots & Persistence

Solve the initial-screen problem without putting persistence in the real-time delivery path.

The client should be able to request:

```text
GET /market-data/COMI
          ↓
Current Snapshot

        +

WebSocket
          ↓
Future Updates
```

Build a persistence/snapshot consumer independently from the Kafka stream:

```text
Kafka
  ├──→ Market Broadcaster → Users
  │
  └──→ Persistence Service → Database/Cache
```

Implement:

- Current-price snapshot storage
- REST snapshot endpoint
- Persistence consumer
- Snapshot freshness metadata
- Recovery/rebuild strategy

**Important:** Persistence must not sit between Kafka and WebSocket delivery.

**Output:** REST snapshot + WebSocket streaming + independent persistence pipeline.
## Phase 13 — Handle Reconnection & Failures

Test the system as if things are actually breaking.

### Exchange

```text
Disconnect
   ↓
Reconnect
   ↓
Resume
```

### Gateway

```text
Gateway dies
   ↓
Client reconnects
   ↓
Resubscribe
```

### Kafka

Test:

- Broker failure
- Consumer restart
- Consumer lag

### Client

Test:

- Network interruption
- App backgrounding
- Reconnection
- Resubscription
- Snapshot refresh after reconnect
- Duplicate subscription handling
- Backoff/jitter during reconnect storms

The reconnect sequence should be:

```text
Disconnect
   ↓
Backoff
   ↓
Reconnect
   ↓
Authenticate
   ↓
Resubscribe
   ↓
Get latest snapshot
   ↓
Resume live updates
```

A reconnecting client should not require replaying every missed market tick for the live-price display.

### Gateway State

Verify that:

- Socket state disappears when a gateway terminates.
- Local subscription state is rebuilt from reconnecting clients.
- Redis routing entries expire when gateway heartbeats stop.
- A stale gateway registration does not cause permanent delivery failures.
- Rolling deployments do not require persistent socket state.

**Output:** Documented failure/recovery strategy.

---

## Phase 14 — Add Observability

Make the system operable.

Metrics:

```text
exchange_updates_received_total
exchange_updates_per_second
kafka_consumer_lag
active_websocket_connections
active_subscriptions
updates_fanned_out_total
dropped_updates_total
slow_clients_total
websocket_send_latency
end_to_end_latency
```

Add:

- Structured logging
- Health checks
- Metrics
- Tracing where useful
- Grafana dashboards

**Output:** Operational dashboard.

---

## Phase 15 — Solve Scaling & Hot Symbols

Now challenge the architecture.

Test:

```text
25K updates/sec
+
100K connections
+
millions of subscriptions
```

Investigate:

- Horizontal gateway scaling
- Kafka partition scaling
- Gateway-local subscriptions
- Redis coordination
- Hot symbols
- Uneven symbol distribution
- Fan-out amplification

This is where we'll decide whether Redis belongs in the hot path.

**Output:** `scalability.md` + architecture decisions.

---

## Phase 16 — Load Test the Entire System

Build a proper load-testing environment.

Simulate:

```text
25,000 exchange updates/sec

        +

many concurrent WebSocket clients

        +

many symbol subscriptions
```

Measure:

| Metric | Result |
|---|---:|
| Exchange ingestion | X/sec |
| Kafka throughput | X/sec |
| P95 latency | X ms |
| P99 latency | X ms |
| WebSocket connections | X |
| Fan-out | X msg/sec |
| CPU | X% |
| Memory | X GB |
| Dropped updates | X |
| Consumer lag | X ms |

**Important:** These numbers must be actual measurements.

**Output:** Benchmark report.

---

## Phase 17 — Build the Real Demo Client

Finally, make the project visually impressive.

A simple market-watch application:

```text
┌──────────────────────────────────┐
│             Tckr                 │
│        Live Market Data          │
├────────┬─────────┬───────────────┤
│ Symbol │ Price   │ Change        │
├────────┼─────────┼───────────────┤
│ COMI   │ 85.42   │ +1.24%        │
│ CIB    │ 91.20   │ -0.31%        │
│ ORAS   │ 312.50  │ +2.18%        │
│ SWDY   │ 52.10   │ +0.72%        │
└────────┴─────────┴───────────────┘

● LIVE

Updates/sec: 27
Latency:     42ms
```

The demo should allow you to:

- Search symbols
- Subscribe/unsubscribe
- Watch multiple symbols
- See prices update live
- Disconnect/reconnect
- Display connection status
- Display latency

**Output:** A real working demonstration of the architecture.

---

# Architecture Boundary Decision

The current Tckr implementation intentionally keeps the number of deployable applications small. The repository has four application processes:

```text
Tckr.MockExchange
Tckr.MarketData.Ingestion
Tckr.MarketData.Distribution
Tckr.MarketData.Gateway
```

## Subscription is not a separate service

Subscription management is a logical responsibility of the Gateway rather than a standalone `Tckr.MarketData.Subscription` application. The Gateway handles authentication, resolves the user's market-data entitlement, accepts symbol subscriptions, validates the requested stream, maintains local WebSocket subscription state, and registers distributed routing metadata in Redis.

This avoids an unnecessary network hop and avoids introducing a microservice boundary without a concrete scaling, ownership, or deployment requirement. If subscription/entitlement management later needs independent scaling or integration with billing/account services, it can be extracted behind a service boundary.

## There is no separate MarketData.Api

A standalone `Tckr.MarketData.Api` is also intentionally removed. `Tckr.MarketData.Gateway` is an ASP.NET Core application and can host both normal HTTP endpoints and WebSocket endpoints. The demo can therefore expose endpoints such as:

```text
GET /health
GET /symbols
GET /symbols/{symbol}/snapshot
WebSocket /ws/market-data
```

This keeps the implementation focused on the interview problem instead of creating microservices for the sake of decomposition. A separate API can be introduced later only when there is a concrete reason for independent HTTP scaling, ownership, deployment, or security boundaries.

## Current application types

| Project | Application type | Primary responsibility |
|---|---|---|
| `Tckr.MockExchange` | .NET Worker/Console executable | Simulate the exchange market-data feed |
| `Tckr.MarketData.Ingestion` | .NET Worker Service | Maintain the single exchange connection, parse/normalize events, publish to Kafka |
| `Tckr.MarketData.Distribution` | .NET Worker Service | Consume market data and produce live/delayed distribution streams |
| `Tckr.MarketData.Gateway` | ASP.NET Core application | HTTP + WebSocket connections, authentication, entitlement, subscriptions, routing and local socket fan-out |

The canonical boundary is therefore:

```text
Exchange
   │
   ▼
MockExchange → Ingestion Worker → Kafka
                                  │
                                  ▼
                         Distribution Worker
                                  │
                              Redis routing
                                  │
                                  ▼
                              Gateway
                           ┌──────┴──────┐
                         HTTP       WebSocket
                           │             │
                      snapshots     live/delayed
                           │             │
                           └───── Clients┘
```

---

# Suggested Repository Structure

Once the project matures:

```text
tckr/
│
├── README.md
│
├── docs/
│   ├── requirements.md
│   ├── architecture.md
│   ├── data-flow.md
│   ├── scalability.md
│   ├── reliability.md
│   ├── benchmarking.md
│   │
│   └── decisions/
│       ├── 001-kafka.md
│       ├── 002-websockets.md
│       ├── 003-symbol-partitioning.md
│       └── 004-latest-value-wins.md
│
├── src/
│   ├── Tckr.MockExchange/
│   ├── Tckr.MarketData.Ingestion/
│   ├── Tckr.MarketData.Distribution/
│   └── Tckr.MarketData.Gateway/
│
├── tests/
│   ├── Unit/
│   ├── Integration/
│   └── Load/
│
├── client/
│   └── Tckr.MarketWatch/
│
├── infrastructure/
│   ├── docker/
│   ├── kafka/
│   ├── redis/
│   └── monitoring/
│
└── benchmarks/
```

---

# Final Architecture

The system has two customer-facing market-data paths:

```text
SUBSCRIBED USERS
LIVE MARKET DATA

Exchange
   ↓
Ingestion
   ↓
Parser
   ↓
Kafka RAW
   ↓
Live Broadcaster
   ↓
Redis: LIVE:<symbol>
   ↓
WebSocket Gateways
   ↓
Subscribed Clients


NON-SUBSCRIBED USERS
15-MINUTE DELAYED MARKET DATA

Exchange
   ↓
Ingestion
   ↓
Parser
   ↓
Kafka RAW
   ↓
Delayed Processor
   ↓
15-minute delay
   ↓
Kafka DELAYED
   ↓
Delayed Broadcaster
   ↓
Redis: DELAYED:<symbol>
   ↓
WebSocket Gateways
   ↓
Non-subscribed Clients
```

# Final Architecture

```text
                           STOCK EXCHANGE
                                │
                         Single TCP Feed
                                │
                                ▼
                     ┌────────────────────┐
                     │ Feed Ingestion     │
                     └──────────┬─────────┘
                                │
                                ▼
                     ┌────────────────────┐
                     │ Market Data Parser │
                     └──────────┬─────────┘
                                │
                                ▼
                           ┌─────────┐
                           │  Kafka  │
                           └────┬────┘
                                │
                                ▼
                     ┌────────────────────┐
                     │ Market Broadcaster │
                     └──────────┬─────────┘
                                │
                         Symbol → Gateways
                                │
                                ▼
                           ┌─────────┐
                           │  Redis  │
                           │ Registry│
                           └────┬────┘
                                │
                 ┌──────────────┼──────────────┐
                 ▼              ▼              ▼
           ┌──────────┐   ┌──────────┐   ┌──────────┐
           │ Gateway 1│   │ Gateway 2│   │ Gateway N│
           └────┬─────┘   └────┬─────┘   └────┬─────┘
                │              │              │
          Local subscription maps
                │              │              │
          ┌─────┼─────┐   ┌────┼────┐    ┌────┼────┐
          ▼     ▼     ▼   ▼    ▼    ▼    ▼    ▼    ▼
        Socket Socket Socket ...        Socket Socket

                                │
                                ▼
                         Mobile / Web Clients
```

Persistence is an independent Kafka consumer:

```text
                         Kafka
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
    Broadcaster       Persistence       Analytics
          │
       Redis
          │
     Gateways
          │
       Clients
```

## Authentication, Entitlement & State Ownership

Authentication and market-data entitlement are separate from connection and routing state.

```text
Client
   ↓
JWT
   ↓
WebSocket Gateway
   ↓
Authentication
   ↓
Entitlement
   ├── LIVE
   └── DELAYED
```

The server determines the user's stream. The client cannot request or override its entitlement.

### State ownership

```text
┌───────────────────────────────┐
│ Identity / Entitlement        │
│                               │
│ Authoritative user access     │
│ User → LIVE / DELAYED         │
└───────────────┬───────────────┘
                │
                ▼
┌───────────────────────────────┐
│ .NET WebSocket Gateway        │
│                               │
│ Ephemeral:                    │
│   Socket objects              │
│   symbol → local sockets      │
│   authenticated UserContext   │
└───────────────┬───────────────┘
                │
                │ routing metadata
                ▼
┌───────────────────────────────┐
│ Redis                         │
│                               │
│ LIVE:COMI → gateways          │
│ DELAYED:COMI → gateways       │
│ gateway heartbeat / TTL       │
└───────────────────────────────┘
```

Redis does **not** become the authoritative entitlement database.

## State Ownership & Recovery

Tckr intentionally separates ephemeral connection state from distributed routing state.

```text
┌───────────────────────────────┐
│ .NET WebSocket Gateway        │
│                               │
│ Ephemeral:                    │
│   Socket objects              │
│   symbol → local sockets      │
└───────────────┬───────────────┘
                │
                │ routing metadata
                ▼
┌───────────────────────────────┐
│ Redis                         │
│                               │
│ Distributed:                  │
│   symbol → gateways           │
│   gateway heartbeat / TTL     │
└───────────────────────────────┘
```

Redis does **not** store WebSocket objects and cannot restore connections after a process restart.

After a gateway restart or rolling deployment:

1. Existing WebSocket connections are lost.
2. Clients reconnect through the load balancer.
3. Clients authenticate and resubscribe.
4. The new gateway rebuilds its local in-memory subscription map.
5. The gateway refreshes its Redis routing registrations.
6. The client receives the latest market snapshot.
7. Live updates continue.

This makes gateway state **reconstructable rather than durable**.

### Market-data data plane

There are two data-plane branches after the authoritative RAW Kafka stream:

```text
Kafka RAW
   │
   ├──→ Live Broadcaster
   │       ↓
   │   LIVE:<symbol>
   │       ↓
   │   Subscribed users
   │
   └──→ Delayed Processor
           ↓
       Kafka DELAYED
           ↓
       Delayed Broadcaster
           ↓
       DELAYED:<symbol>
           ↓
       Non-subscribed users
```

### Subscription control plane

```text
Exchange
   ↓
Ingestion
   ↓
Parser
   ↓
Kafka
   ↓
Broadcaster
   ↓
Redis routing lookup
   ↓
Gateway
   ↓
Local subscription map
   ↓
WebSocket
   ↓
Client
```

### Subscription control plane

```text
Client
   ↓
WebSocket Gateway
   ↓
Local subscription state
   ↓
Redis distributed registry
```

Redis maps **symbols to gateways**, while each gateway maps **symbols to its local sockets**.

Redis is therefore **not in the per-socket hot path**.

For live market-price presentation, a reconnecting client does not need every missed tick. It obtains the latest snapshot and then resumes the live stream. The authoritative Kafka stream remains available for internal consumers that require durable event processing.

The key scaling principle is:

> **Ingest once, route at the gateway level, then fan out locally in memory.**

The key resilience principle is:

> **Persist routing metadata, not connections; make gateway state reconstructable through client reconnect and resubscription.**

The key entitlement principle is:

> **Authentication identifies the user; authorization determines LIVE vs. DELAYED; the client never chooses its market-data tier.**

The key delayed-stream principle is:

> **Create the 15-minute delayed event stream once and distribute it to all entitled users rather than maintaining a delay queue per client.**

## Core Principle

> **Don't build complexity before proving that you need it.**

Start with **Exchange → Ingestion**, measure it, then introduce each component because it solves a demonstrated scalability or reliability problem. The final architecture should support multiple gateways, distributed subscription routing, and local socket fan-out without unnecessarily putting Redis or persistence in the per-update/per-socket hot path.
