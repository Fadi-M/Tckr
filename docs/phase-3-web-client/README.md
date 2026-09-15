# Phase 3 — Market Watch Web Client

> Canonical plan for Phase 3 of Tckr. Read this before opening any task file.
> Parent document: [`../MASTER CONTEXT.md`](../MASTER%20CONTEXT.md) ·
> Requirements: [`../requirements.md`](../requirements.md) ·
> **The contract this phase freezes: [`client-contract.md`](client-contract.md)**

---

## 1. Problem Definition

Tckr's reason to exist is a person looking at a price.

```text
      Exchange ─▶ … 16 phases of infrastructure … ─▶ ???
```

Everything between the exchange and that person is justified by what the person needs:
a list of instruments, a price that moves, a chart, and an honest statement of whether
they are seeing live data or data from fifteen minutes ago. Phase 3 builds that end of
the system **first**, so the sixteen phases in between are built to satisfy a consumer
that already exists rather than one we imagine later.

The client is written against a contract — [`client-contract.md`](client-contract.md) —
that the gateway will not be able to serve until Phase 11. That is the point. When the
gateway arrives, the client changes **one line of configuration**:

```text
Phase 3     UI ─▶ MarketDataSource ─▶ SimulatedSource     (browser, no backend)
Phase 11+   UI ─▶ MarketDataSource ─▶ TckrGatewaySource   (ws://gateway/ws/market-data)
```

If anything else has to change at that point, the contract was wrong, and finding that
out is worth more than any pixel in this phase.

---

## 2. Why This Is Not Trivial

The naive version is a table bound to a WebSocket:

```ts
socket.onmessage = e => setPrices(p => ({ ...p, ...JSON.parse(e.data) }));
```

That version fails Phase 3 for five separate reasons:

| Problem | Consequence |
|---|---|
| One React state update per tick | At a hot symbol's rate the render loop, not the network, becomes the bottleneck and the tab stutters |
| `JSON.parse` gives `85.42` as an IEEE-754 double | Cent-level drift in a financial display; the project bans floating-point prices everywhere else |
| The socket is wired directly into components | Every component has to be rewritten when the real gateway lands — the exact opposite of plug-and-play |
| No reconnect discipline | A gateway restart produces a synchronised reconnect storm from every open tab |
| The client decides what it displays as "live" | The one security property the whole system exists to enforce, broken in the last mile |

The real deliverable is therefore **a client whose data source is replaceable and whose
render path survives a hot symbol** — not a table that looks right in a screenshot.

---

## 3. Scope

### In scope

- `client/Tckr.MarketWatch` — React 19 + TypeScript + Vite.
- A stock list over the mock exchange's **named** symbol universe (34 instruments),
  with price, change, change %, and last-update time.
- Search and sort on the list.
- A per-symbol detail view with a **price-vs-time chart** that updates as ticks arrive.
- `MarketDataSource` as the single seam, with two implementations: `SimulatedSource`
  (this phase) and `TckrGatewaySource` (written to the contract, exercised against
  fixtures, unusable until Phase 11).
- TypeScript mirrors of the contract's message shapes, with decimal-safe prices.
- Connection lifecycle: status, heartbeat timeout, reconnect with backoff and jitter,
  snapshot-then-resume, subscribe/unsubscribe on navigation.
- LIVE / DELAYED badge sourced from the server's assignment, never from client state.
- A visible, permanent "simulated data" marker.

### Out of scope (deliberately)

- Any backend. No .NET project is added or modified in this phase.
- Real authentication. The simulated source issues a fake `UserContext`; the JWT flow
  is Phase 8's, and the client only needs the token-shaped hole to exist.
- Order entry, portfolios, watchlist persistence across devices, alerts, news.
- Order-book depth. The tape carries trades and top-of-book quotes; there is no depth
  to draw.
- Real 15-minute delay. Simulated DELAYED uses a short labelled offset — see
  [`client-contract.md`](client-contract.md) §5.
- Charting beyond price-vs-time (no candlesticks, no indicators, no drawing tools).

---

## 4. Component Design

```text
                    ┌────────────────────────────────────────────────────┐
                    │                Tckr.MarketWatch                    │
                    │                                                    │
  symbols.json ────▶│  SymbolUniverse ──┐                                │
  (copied, cited)   │                   │                                │
                    │                   ▼                                │
                    │        ┌──────────────────────┐                    │
                    │        │   MarketDataSource   │  ◀── interface     │
                    │        └──────────┬───────────┘                    │
                    │             ┌─────┴──────┐                         │
                    │             ▼            ▼                         │
                    │  SimulatedSource   TckrGatewaySource               │
                    │  (random walk,     (ws + REST, contract v1,        │
                    │   Zipf skew,        fixture-tested, dormant)       │
                    │   fake entitlement)                                │
                    │             │            │                         │
                    │             └─────┬──────┘                         │
                    │                   ▼                                │
                    │            TickDispatcher   ── coalesce per symbol │
                    │             │           │      (latest-value-wins) │
                    │             ▼           ▼                          │
                    │        StockList    StockDetail ──▶ PriceChart     │
                    └────────────────────────────────────────────────────┘
```

### Key design decisions

Settled. If you believe one is wrong, record it in your task's *Notes* and keep building.

1. **React 19 + TypeScript + Vite.** Chosen over Blazor WASM so the contract is proven
   as plain JSON consumed by a non-.NET client — which is what a real mobile or web
   client would be. See [ADR 006](../decisions/006-client-data-source-contract.md).
2. **One interface, two sources, config-selected.** `MarketDataSource` is the only way
   any component obtains market data. No component imports a WebSocket or the simulator.
3. **Prices are strings end to end.** They arrive as decimal strings, are stored as
   strings, compared with a small decimal helper, and formatted for display. A price
   never becomes a JS `number`. Percentage change may be a number — it is presentational.
4. **Coalescing is the render contract, not an optimisation.** `TickDispatcher` keeps
   the newest tick per symbol and flushes on `requestAnimationFrame`. A symbol taking
   15% of a 25,000/sec tape would otherwise schedule ~3,750 renders per second.
   Latest-value-wins here is the client half of NFR-3.1 — legitimate for a *display*,
   never for the delayed tape itself.
5. **The chart keeps a bounded ring buffer** (default 600 points) and drops the oldest.
   An unbounded points array is the browser-side version of the unbounded queue the
   master context bans server-side.
6. **`TckrGatewaySource` is written and tested in this phase, against recorded
   fixtures**, even though nothing can serve it yet. A source written in Phase 11 would
   be written to whatever the gateway happened to do; a source written now is what the
   gateway must satisfy.
7. **Entitlement is display-only state derived from server messages.** There is no
   client-side setter for it, and no UI that offers to change it. The type that carries
   it is readonly and constructed only by source implementations.
8. **uPlot for the chart.** MIT, canvas, ~40KB, built for streaming appends — 600 points
   redrawn once per animation frame is nothing to it. TradingView's lightweight-charts
   would give the financial furniture free but carries an attribution requirement on the
   chart itself; Recharts puts one SVG node per point, which fails exactly where this
   phase applies pressure. The axis, crosshair and price formatting glue is ours, which
   is what keeps the decimal-string rule intact through to the pixels.
9. **An external store read through `useSyncExternalStore`.** A tick must re-render one
   row, not the tree. React context holding a price map re-renders every consumer on
   every flush; `useSyncExternalStore` with a per-symbol selector is the React-native
   answer and costs no dependency.
10. **The performance claim is measured twice, differently.** Vitest asserts the
    deterministic invariant on every CI run (one flush per frame, coalescing ratio); one
    Playwright run measures real frame timing in a real browser and its numbers go in
    `results.md` (written by task 09) with an environment capture. Same rule as Phase 2: a
    number in a document points at a file on disk, or it is not a number.

---

## 5. Target Repository Layout

```text
client/Tckr.MarketWatch/
├── index.html
├── package.json / tsconfig.json / vite.config.ts        (task 01)
├── public/
│   └── symbols.json                    copy of the exchange universe (task 02)
└── src/
    ├── main.tsx / App.tsx                               (task 03)
    ├── contracts/
    │   ├── messages.ts                 wire message types, contract v1   (01)
    │   ├── decimal.ts                  decimal-string helpers            (01)
    │   └── fixtures/                   recorded contract-conformant JSON (01)
    ├── data/
    │   ├── MarketDataSource.ts         the seam                          (02)
    │   ├── SimulatedSource.ts          browser generator                 (02)
    │   ├── TckrGatewaySource.ts        ws + REST, dormant until Phase 11 (08)
    │   ├── TickDispatcher.ts           coalescing + subscription fan-out (02)
    │   ├── store.ts                    external store, per-symbol slices (02)
    │   └── config.ts                   which source, from env            (02)
    ├── pages/
    │   ├── StockList.tsx                                                 (04)
    │   └── StockDetail.tsx                                               (06)
    ├── chart/
    │   └── PriceChart.tsx              price vs. time, ring buffer       (05)
    ├── components/
    │   ├── StreamBadge.tsx             LIVE / DELAYED, server-assigned   (07)
    │   ├── ConnectionStatus.tsx                                          (07)
    │   └── SimulatedBanner.tsx                                           (03)
    └── __tests__/                      Vitest suites, one per area

perf/
├── playwright.config.ts                the one recorded browser run       (01/09)
└── frame-timing.spec.ts                                                   (09)

docs/phase-3-web-client/results.md      measured fps + environment capture (09)
```

> `client/` already exists and is empty; the master context's suggested structure names
> `client/Tckr.MarketWatch`. Nothing under `src/`, `tests/`, `tools/` or `benchmarks/`
> is touched by this phase.

---

## 6. Task Breakdown

Nine tasks. Each is scoped for one agent that knows only its brief and the contract.

| # | Task | Depends on | Parallelisable with |
|---|---|---|---|
| [01](01-scaffold-contracts-and-fixtures.md) | Project scaffold, contract types, decimal helpers, fixtures | — | — |
| [02](02-data-source-and-dispatcher.md) | `MarketDataSource`, `SimulatedSource`, `TickDispatcher`, store, config | 01 | 03 |
| [03](03-app-shell.md) | App shell, routing, layout, theme, simulated banner | 01 | 02 |
| [04](04-stock-list.md) | Stock list page — search, sort, live cells | 02, 03 | 05, 06 |
| [05](05-price-chart.md) | `PriceChart` — uPlot, ring buffer, coalesced render | 02, 03 | 04, 06 |
| [06](06-stock-detail.md) | Stock detail page — snapshot then stream, subscribe lifecycle | 02, 03 | 04, 05 |
| [07](07-connection-lifecycle.md) | Connection lifecycle UI — status, backoff, stream badge, close codes | 06 | 08 |
| [08](08-gateway-source-conformance.md) | `TckrGatewaySource` + contract conformance suite against fixtures | 01, 02 | 07 |
| [09](09-docs-and-recorded-perf.md) | Client README, swap instructions, recorded perf run, DoD evidence | 04–08 | — |

### Dependency graph

```text
  Wave 1    01
             │
  Wave 2     ├──▶ 02 ──┐
             └──▶ 03 ──┤
                       ▼
  Wave 3     04 ─── 05 ─── 06        (fully parallel, all need 02 + 03)
                            │
  Wave 4     08 ◀───────────┼──▶ 07
                            │
  Wave 5                    └──▶ 09
```

Critical path: `01 → 02 → 06 → 07 → 09`. Task 08 sits off it and is the one that proves
the plug-and-play claim — cut anything before cutting 08.

---

## 7. File Ownership Matrix

Exclusive, as in Phase 2. A task needing a change in a file it does not own records the
request in its *Notes* for the owner to apply.

| Path | Owner |
|---|---|
| `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html` | 01 |
| `src/contracts/**` | 01 |
| `src/data/MarketDataSource.ts`, `SimulatedSource.ts`, `TickDispatcher.ts`, `store.ts`, `config.ts` | 02 |
| `public/symbols.json` | 02 |
| `src/main.tsx`, `src/App.tsx`, `src/components/SimulatedBanner.tsx` | 03 |
| `src/pages/StockList.tsx` | 04 |
| `src/chart/**` | 05 |
| `src/pages/StockDetail.tsx` | 06 |
| `src/components/StreamBadge.tsx`, `ConnectionStatus.tsx` | 07 |
| `src/data/TckrGatewaySource.ts` | 08 |
| `perf/**`, `docs/phase-3-web-client/results.md` | 09 |
| `client/Tckr.MarketWatch/README.md`, `docs/decisions/006-*.md` | 09 |

Each task owns its own `__tests__/<area>/` files.

---

## 8. Conventions

- TypeScript `strict`, no `any` in `src/` outside a fixture loader.
- **No JS `number` for a price.** Enforced by the type system: prices are a branded
  `DecimalString`, and the only way to arithmetic is through `contracts/decimal.ts`.
- No component may import `SimulatedSource` or `TckrGatewaySource` directly — only the
  `MarketDataSource` interface and the config factory. A test asserts this.
- No client→server message type may carry a stream, tier or user field (FR-6). A test
  asserts the outbound union.
- Tests: Vitest + Testing Library. Fake timers for anything involving backoff or
  heartbeats; no `sleep` in tests.
- Every task leaves `npm run build` and `npm test` green.
- Accessible and usable at 400px wide — this is a price display people check on a phone.

---

## 9. Definition of Done (Phase 3)

Measured, not assumed. Each item names how it is checked.

- [x] `npm run build`, `npm run typecheck` and `npm test` are green from a clean clone.
      Verified 2026-09-12 from a full-repo copy at a scratch path (`rsync` of the working
      tree, excluding `.git`/`node_modules`/`dist`/`bin`/`obj`, so the client's
      `universe.parity.test.ts` sibling-path read against
      `src/Tckr.MockExchange/Reference/symbols.json` resolves exactly as in a real
      clone) — `npm ci && npm run build && npm run typecheck && npm test` all green:
      **71 files / 309 tests passed**, clean `tsc --noEmit`, clean `vite build`. The
      gateway-swap build (`VITE_TCKR_SOURCE=gateway npm run build`) also succeeded from
      the same clean copy, following only `README.md`.
- [x] The list renders all 34 named instruments from the exchange's own `symbols.json`,
      with no symbol invented in the client (test compares against the copied file).
      `src/pages/__tests__/StockList.universe.test.tsx` ("renders exactly the 34 named
      instruments from public/symbols.json, and no others") and
      `src/data/__tests__/universe.parity.test.ts` (byte-identical `cmp` against
      `src/Tckr.MockExchange/Reference/symbols.json`, confirmed independently this
      session: `cmp client/Tckr.MarketWatch/public/symbols.json
      src/Tckr.MockExchange/Reference/symbols.json` → no output, i.e. identical).
- [x] Clicking a symbol opens a detail view that paints from a snapshot **before** the
      first tick arrives, then updates continuously (test asserts snapshot-then-stream
      ordering). `src/pages/__tests__/StockDetail.snapshot-first.test.tsx` ("renders the
      snapshot before a tick that arrives while it is still in flight, and ends on the
      tick (newer wins)").
- [x] The chart plots price against wall-clock time and holds up under a hot-symbol
      load, proved two ways:
      **(a) CI invariant, Vitest** — 3,750 ticks/sec into one symbol produces at most one
      flush per animation frame and a coalescing ratio ≥50x, asserted on every run;
      **reproduced this session**: `received=225000 flushed=60 ratio=3750x`
      (`dispatcher.coalescing.test.ts`, raw stdout in
      `client/Tckr.MarketWatch/perf/raw/vitest-invariants/dispatcher.coalescing.out.txt`).
      **(b) recorded run, Playwright** — real frame timing in a real Chromium under the
      same load (`/symbols/COMI` at `VITE_TCKR_SIM_RATE=25000`, COMI's measured 15.11%
      share ≈ 3,777 ticks/sec). The **load-bearing number is the coalesced flush path's
      own cost**: `rafCallbackDurationMs` p95 **0.0999 ms** (mean 0.0101 ms, max 0.2 ms)
      against a 16.7 ms frame budget — **≈0.6% of budget consumed** by the store-write
      flush plus `uPlot.setData` redraw combined, median across 3 runs. fps (median
      **60.00**, spread 0.0001, zero dropped frames) clears the ≥30 fps floor and is
      recorded as supporting evidence that no frame was actually dropped, **but is not
      the number this box rests on** — a headless-Chromium native rAF loop is
      vsync-locked and reads ~60 fps regardless of render-path cost up to and beyond a
      real regression (see `results.md` §3.1's control experiment). Full write-up,
      control experiment, and environment capture: `docs/phase-3-web-client/results.md`
      §3; raw JSON: `client/Tckr.MarketWatch/perf/raw/frame-timing/run{1,2,3}/result.json`.
- [x] The ring buffer is bounded: 100,000 ticks into one chart leaves memory flat and
      the points array at its configured cap (test). `ringBuffer.capacity.test.ts`
      (100,000 pushes → `length === 600`) and `ringBuffer.no-alloc.test.ts` (same
      `Float64Array` references throughout); reproduced this session, raw stdout in
      `client/Tckr.MarketWatch/perf/raw/vitest-invariants/ringBuffer.out.txt`.
- [x] Switching from `SimulatedSource` to `TckrGatewaySource` is **one environment
      variable**, with zero changes to any component (proven by the conformance suite in
      task 08 running the identical page-level tests against both sources).
      `src/data/__tests__/conformance/conformance.equivalence.test.tsx` runs the same
      `StockDetail`/`StockList` assertions against a `FakeWebSocket`-backed
      `TckrGatewaySource` as against `SimulatedSource`; reproduced this session
      (`npm test`, 71/309 green, includes this file). Also reproduced directly: a clean
      clone's `VITE_TCKR_SOURCE=gateway npm run build` succeeds with no edit to any file
      under `src/pages/`, `src/chart/` or `src/components/` — only `src/data/config.ts`
      (the seam itself) branches on the variable.
- [x] `TckrGatewaySource` satisfies every message shape in `client-contract.md` against
      recorded fixtures, including `entitlementChanged`, all five error codes and all
      four abnormal close codes. `conformance.messages.test.ts` (covers
      `entitlementChanged` via the `entitlement-downgraded`/`entitlement-upgraded`
      fixtures), `conformance.errors.test.ts` (`UNKNOWN_SYMBOL`, `SUBSCRIPTION_LIMIT`,
      `NOT_ENTITLED`, `RATE_LIMITED`, `INTERNAL` — all five), `conformance.close-codes.test.ts`
      (`4401`, `4403`, `4408`, `4429` — all four abnormal codes, plus `1000` for
      contrast, and an unmapped code case for real-world proxies).
- [x] No outbound message can carry a stream/tier/user field, and the LIVE/DELAYED badge
      is derived only from server messages (type-level + test).
      `messages.outbound.test.ts` (`@ts-expect-error` on each forbidden field, plus a
      runtime "drops smuggled keys even if the type system is bypassed" test) and
      `badge.no-client-source.test.tsx` (`StreamBadge` takes zero props and renders
      nothing while `identity()` is `null` — never a LIVE-by-default fallback).
- [x] Reconnect uses exponential backoff with jitter, ceiling 30 s, verified with fake
      timers across 10 simulated drops. `reconnect.backoff.test.ts` — exact sequence
      `500, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000` ms at `rand=0.5`
      across 10 attempts; `reconnect.jitter.test.ts` — attempt 3 spans exactly
      `[1600, 2400]` ms. Reproduced this session, raw stdout in
      `client/Tckr.MarketWatch/perf/raw/vitest-invariants/reconnect.backoff-jitter.out.txt`.
- [x] A visible "simulated data" marker appears on every screen, and the DELAYED offset
      is labelled as a simulation artifact wherever it is shown (test).
      `shell.banner-everywhere.test.tsx` (present on every route, no dismiss control),
      `shell.banner-delay-label.test.tsx` and `StockDetail.delayed-labelling.test.tsx`
      (offset stated and explicitly labelled "this is a simulation artifact; the real
      delay is 15 minutes" wherever DELAYED is shown).
- [x] `client/Tckr.MarketWatch/README.md` documents how to run it and exactly what
      changes at the Phase 11 swap. Written this task — see its "Running it" and "The
      swap" sections, including the full contract-ambiguity list carried forward from
      task 08 / ADR 006.

---

## 10. Demo Value

This phase is what makes the other seventeen legible to someone who is not going to read
`MASTER CONTEXT.md`:

- *"What are you actually building?"* — a screen, in a browser, with prices moving.
- *"What does 15 minutes delayed mean?"* — two windows side by side, the same symbol,
  visibly out of step.
- *"Why is the architecture shaped like that?"* — because this client, unchanged, must
  keep working when the thing behind it becomes Kafka, Redis and a gateway cluster.

And it front-loads the contract argument: by the time the gateway is built, its
client-facing shape has been fixed, reviewed and tested for fifteen phases.
