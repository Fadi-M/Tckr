# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Traders and investors who want to watch live prices for individual instruments: browse
a searchable/sortable universe of symbols, then drill into one symbol for a price-vs-time
chart that updates as ticks arrive. A user's entitlement (subscribed vs. non-subscribed)
determines whether they see LIVE data or data delayed by 15 minutes — that distinction is
resolved server-side and must always be visible to the user, never inferred or spoofed
client-side.

## Product Purpose

Tckr is a real-time market-data distribution platform: it takes one exchange connection
carrying ~25,000 events/sec for all symbols and fans it out to many concurrent users,
each seeing only the symbols they care about, at the freshness their entitlement allows
(live or 15-minutes-delayed). Tckr.MarketWatch (Phase 3) is the client end of that
system — the reason the rest of the platform exists is a person looking at a price move
in real time. Success is a client that stays responsive under a hot symbol's tick rate,
never fabricates or blurs the live/delayed distinction, and never loses decimal precision
on a price.

## Positioning

Tckr is explicitly a market-data distribution platform, not a brokerage: no order entry,
no OMS, no portfolio/settlement/payments. Its differentiated mechanism is the fan-out and
entitlement design — one upstream exchange connection serving many WebSocket clients,
each strictly gated to LIVE or 15-minute-DELAYED data by server-side entitlement, with
failure modes (backpressure, slow consumers, reconnection, hot symbols) treated as core
design surface rather than edge cases.

## Operating Context

This client (`client/Tckr.MarketWatch`) is Phase 3 of a multi-phase build; the upstream
gateway (`ws://.../ws/market-data` + REST) that will eventually serve it is Phase 11 and
does not exist yet. Until then, `SimulatedSource` (a seeded in-browser random walk over a
34-instrument fictional universe, `public/symbols.json`) stands in for the real feed. A
permanent, undismissable "simulated data" banner is no longer a product requirement; it was
deliberately removed in the frosted-glass revamp. The two data sources
(`SimulatedSource`, `TckrGatewaySource`) implement one `MarketDataSource` interface so the
swap to a real gateway is a single environment-variable change with no component changes;
this interface boundary is a durable architectural constraint that future UI work must not
cross (no page/component may import a concrete source directly).

The target market is the Egyptian Exchange (EGX). The client follows EGX's real trading
calendar (Sunday–Thursday, ~10:00–14:30 `Africa/Cairo`, including Egypt's DST rule, with a
09:30–10:00 pre-open auction), and market-open/closed state is part of what a user sees.
The instrument universe is fictional but modelled on an EGX board (ticker shapes, names,
price magnitudes, tick sizes, lot sizes), so future work should assume EGX conventions
rather than a generic or US-market default.

## Capabilities and Constraints

- Searchable, sortable list of the instrument universe (symbol, name, price, change,
  change %, volume, last update); a single symbol's tick re-renders only that row.
- Per-symbol detail view with a live-updating price-vs-time chart (price-vs-time only —
  no candlesticks, indicators, or drawing tools in this phase).
- Connection lifecycle is user-visible: connect/reconnect status, heartbeat timeout,
  backoff with jitter, and a stale/held state when the stream drops (prices freeze
  visibly rather than silently going wrong).
- Prices are never JS `number`/floating point at any point they reach a user or the
  wire — decimal-safe string types are enforced throughout, because cent-level drift is
  unacceptable in a financial display.
- The LIVE/DELAYED distinction is a security property, not a display choice: it is
  always sourced from the server/entitlement, never computed or overridable client-side,
  and up/down price moves always carry a non-color signal (arrow glyph) for
  colorblind-safe reading.
- Real authentication does not exist yet (Phase 8); the client is written against the
  token-shaped hole in the contract but currently uses a demo user id.
- Order-book depth, alerts, news, watchlist persistence, and portfolios are out of scope
  for this client.

## Brand Commitments

- Name: **Tckr**. The logo is a candlestick "T" mark followed by a "ckr" wordmark in IBM
  Plex Mono 600 (letter-spacing −0.02em). The lockup has no "Market Watch" text.
- The candle is always green (#0F7A4D on light surfaces, #3FD79C mint on dark). There is
  no red or coral variant, whatever the price direction.
- Crossbar and wordmark are ink #14181F on light surfaces and white #FFFFFF on dark.
- Lockup proportions: mark height = 1.15 × wordmark size, mark width = 0.8 × mark height,
  gap ≈ 0.06 × wordmark size, bottoms aligned. Minimums: wordmark 14px, mark alone 16px
  tall. Clear space: one mark width on every side.
- The favicon is the light frosted app icon (`public/logo/tckr-icon-light.svg`). In the app
  the lockup is `src/components/TckrLogo.tsx`, themed via `--tckr-logo-ink` /
  `--tckr-logo-candle`.

## Evidence on Hand

- `docs/phase-3-web-client/client-contract.md` — the frozen v1 wire contract (REST +
  WebSocket) this client and the future gateway both implement.
- `docs/phase-3-web-client/README.md` and `docs/decisions/006-client-data-source-contract.md`
  — phase scope, component design, and the architecture decisions/ambiguities this phase
  settled.
- `docs/MASTER CONTEXT.md` / `docs/requirements.md` — the overall platform's problem
  statement, non-functional requirements, and explicit non-goals.
- Logo source of truth: the "Tckr Logo Final.dc.html" page and its `logo/README.md` in
  the claude.ai/design project (id `87645981-9ff7-46fb-a836-7fe76143a924`).
- No real market data, customers, testimonials, or pricing exist; all instruments, names,
  and price moves in the running app are fictional and must not be presented as real.

## Product Principles

- The live/delayed distinction is inviolable: it is always server-sourced, always visible,
  and never inferred, cached, or spoofed on the client.
- Correctness under load beats polish: a hot symbol must not stutter the render loop, and
  a reconnect storm must not be reproducible from this client's behavior.
- Money is never a float: decimal-safe types are non-negotiable anywhere a price is
  displayed, compared, or transmitted.
- The data-source seam (`MarketDataSource`) is sacred — no page or component may depend on
  which concrete source is behind it.

## Accessibility & Inclusion

Price direction (up/down) must never rely on color alone — an arrow glyph or equivalent
non-color signal must accompany every colored delta, called out explicitly because
roughly 1 in 12 men has red/green color-vision deficiency.
