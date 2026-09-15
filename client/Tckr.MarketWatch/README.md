# Tckr · Market Watch

A React 19 + TypeScript + Vite client for Tckr's market-data contract: a searchable list
of instruments, a per-symbol chart that updates as ticks arrive, and a visible LIVE /
DELAYED distinction sourced only from the server. It is Phase 3 of the Tckr project —
see [`docs/phase-3-web-client/README.md`](../../docs/phase-3-web-client/README.md) for
the full phase plan.

> **This app's data is simulated.** Every price, symbol and quote in this client comes
> from `SimulatedSource`, a seeded random walk running entirely in your browser — no
> backend exists in this phase. It is shaped like the mock exchange's tape but it is not
> a market: the instruments are fictional, the moves are not real, and there is no
> exchange behind them. A banner saying so is on every screen, permanently and
> undismissably, by design.

---

## Running it

```bash
npm install
npm run dev          # http://localhost:5173, hot-reloading
```

```bash
npm run typecheck    # tsc --noEmit
npm test             # vitest run — 71 files / 309 tests, jsdom, no browser needed
npm run build        # production build to dist/
npm run preview      # serve dist/ at http://localhost:4173
```

### The recorded performance run

One more thing exists that the commands above don't cover: a **real-browser** frame-timing
and 400px-layout measurement, run deliberately rather than in CI (frame timing is a noisy,
environment-sensitive signal — a bad CI gate, the same reasoning that made Phase 2's
flat-rate check misfire on a phase-driven load). It needs a real Chromium, installed once:

```bash
npx playwright install chromium   # or: npx playwright install --with-deps chromium
```

Then, from `client/Tckr.MarketWatch`:

```bash
# Frame timing under the phase's hot-symbol load (COMI at ~15% of a 25,000/sec tape):
VITE_TCKR_SIM_RATE=25000 npm run build
VITE_TCKR_SIM_RATE=25000 npm run test:perf     # perf/frame-timing.spec.ts + perf/layout-400.spec.ts

# 400px layout / axis-label check specifically (cheaper, default rate — see why in
# docs/phase-3-web-client/results.md §2/§3.3):
npm run build
npx playwright test -c perf/playwright.config.ts perf/layout-400.spec.ts --reporter=list
```

Raw output lands under [`perf/raw/`](perf/raw/) (JSON per run, plus screenshots for the
layout check); the written-up, environment-captured results are in
[`docs/phase-3-web-client/results.md`](../../docs/phase-3-web-client/results.md). Every
number in that document points at a file under `perf/raw/` — if you can't reproduce one,
that document says so rather than repeating it.

---

## The swap — what Phase 11 (or anyone standing up a real gateway) does here

The entire premise of this phase is that going from the simulator to a real gateway is
**one environment variable**, changing zero components:

```bash
VITE_TCKR_SOURCE=gateway VITE_TCKR_GATEWAY_URL=ws://localhost:5000 npm run build
```

That's it — no file in `src/pages/`, `src/chart/`, or `src/components/` needs to change.
`src/data/config.ts`'s `createMarketDataSource()` is the **only** place either concrete
source (`SimulatedSource` / `TckrGatewaySource`) is named; every page and component reads
market data only through the `MarketDataSource` interface, obtained via
`getSharedSource()`. Flip the env var, rebuild, and the exact same UI tree is now backed
by a real WebSocket instead of an in-browser random walk.

### What changes, and what does not

| | Simulated (default) | Gateway (`VITE_TCKR_SOURCE=gateway`) |
|---|---|---|
| Data origin | `SimulatedSource`, a seeded random walk in the tab | `TckrGatewaySource`, a real WebSocket to `VITE_TCKR_GATEWAY_URL` + REST to the same origin |
| Wire format | in-memory objects, never serialized | JSON over the wire, exactly [`client-contract.md`](../../docs/phase-3-web-client/client-contract.md) v1 |
| LIVE/DELAYED | fake `UserContext` from `VITE_TCKR_USER` (`user-001` → LIVE, `user-002` → DELAYED) | resolved server-side from the real JWT's entitlement |
| DELAYED offset | a labelled **15-second** simulation artifact (`VITE_TCKR_SIM_DELAY_MS`, default 15000) — see client-contract.md §5 | the real 15-minute delayed path, produced server-side |
| Auth | none — `VITE_TCKR_USER` is a demo id, not a token | `?access_token=<jwt>` on the WebSocket URL (contract §3.1) — **Phase 8's JWT issuance is not built yet**, so this path is written and fixture-tested but cannot be exercised against a real token until then |
| Every page, every component, the store, the coalescing dispatcher, the chart | **unchanged** | **unchanged** |

`TckrGatewaySource` (`src/data/TckrGatewaySource.ts`) was written and fixture-tested in
this phase, against recorded contract-conformant fixtures
(`src/contracts/fixtures/`) — see `src/data/__tests__/conformance/`, which runs the
*same* page-level test suite against both sources to prove behavioural equivalence. It is
unusable until a gateway actually exists to serve it (Phase 11); nothing in this phase
pretends otherwise.

### What the gateway must serve

Everything in [`client-contract.md`](../../docs/phase-3-web-client/client-contract.md) —
`GET /symbols`, `GET /symbols/{symbol}/snapshot`, `GET /health`, and the
`/ws/market-data` WebSocket with its five server→client message types, five error codes,
and four abnormal close codes. `docs/decisions/006-client-data-source-contract.md`'s
addenda record the architecture decisions this phase settled on top of that contract
(the shared-connection singleton, the `entitlementChanged` discard, optional
`connectionState()`).

### Contract ambiguities Phase 11 inherits

The contract is frozen at v1 and deliberately was not amended to resolve these — they are
places `TckrGatewaySource` had to make a reading, and a real gateway that reads the
contract differently will disagree with the client silently rather than loudly. Full
detail and source citations: `docs/decisions/006-client-data-source-contract.md`'s
"contract gaps for the Phase 11 gateway implementer" addendum. Summary:

- **`RATE_LIMITED`** says "back off" with no magnitude — the client uses a fixed 2 s
  window (`TckrGatewaySource.ts`, `RATE_LIMIT_BACKOFF_MS`).
- **Close codes outside the contract's five** (a real proxy can emit `1006`/`1001`) have
  undefined behaviour — the client treats any unmapped code as reconnectable.
- **`entitlementChanged.resubscribeRequired`** — unclear whether the client must resend
  `subscribe` frames or whether this is purely a UI discard signal. The client does not
  auto-resubscribe.
- **No JWT/token field on `ClientConfig`** — the client uses the demo user id as an
  `?access_token=` placeholder; real issuance is Phase 8's.
- **Client-initiated `ping`** is defined but never mandated — the client sends one per
  `heartbeatIntervalMs` as its own liveness probe, not something the contract requires of
  every client.
- **No "never connected yet" `ConnectionState` variant** — `connectionState()` reports the
  same shape before the first connect as it would after a genuine `closed` disconnect.
- **`GET /symbols` ordering** — the client's default list order is the universe array's
  own order (weight-descending in the mock exchange's file). **The gateway must preserve
  weight-descending order**, or the default view changes silently.
- **No heartbeat surface on `MarketDataSource`** — `reconnect.ts`'s
  `createHeartbeatWatchdog` exists and is unit-tested but is deliberately left unwired in
  both sources (the simulator never heartbeats; wiring it to nothing would cause spurious
  30 s reconnect loops). Phase 11 needs an `on.heartbeat` handler or a
  `heartbeatIntervalMs` on `Identity` before this can be switched on.

---

## Architecture — the one seam

```text
                              MarketDataSource            (interface, src/data/MarketDataSource.ts)
                                     ▲
                    ┌────────────────┴────────────────┐
                    │                                  │
             SimulatedSource                    TckrGatewaySource
     (seeded random walk, in-browser,       (WebSocket + REST, client-contract.md v1,
      Zipf-weighted symbol skew,             fixture-tested against recorded JSON,
      fake LIVE/DELAYED assignment)          dormant until a gateway exists — Phase 11)
                    │                                  │
                    └────────────────┬─────────────────┘
                                      ▼
                          config.ts: createMarketDataSource()
                          — the ONE place either class is named —
                          wrapped by getSharedSource() into an
                          app-wide singleton (one connection, ever)
                                      │
                                      ▼
                               TickDispatcher
                    (coalesces per symbol, flushes ≤1×/animation frame —
                     README.md design decision #4: the render contract,
                     not an optimisation)
                                      │
                                      ▼
                                  store.ts
                    (external store, per-symbol subscriptions via
                     useSyncExternalStore — a tick re-renders one row)
                              │              │
                              ▼              ▼
                          StockList     StockDetail ──▶ PriceChart
                        (search, sort,   (snapshot-then-stream,        (uPlot, bounded
                         live cells)      subscribe lifecycle)          ring buffer)
```

No component imports `SimulatedSource` or `TckrGatewaySource` directly — only the
`MarketDataSource` type and `getSharedSource()`/`createMarketDataSource()` from
`src/data/config.ts`. A test in `src/data/__tests__/` asserts this.

---

## Further reading

- [Phase 3 plan](../../docs/phase-3-web-client/README.md) — scope, component design, file
  ownership, and the phase Definition of Done (§9).
- [`client-contract.md`](../../docs/phase-3-web-client/client-contract.md) — the frozen
  v1 wire contract this client and the future gateway both implement.
- [ADR 006](../../docs/decisions/006-client-data-source-contract.md) — why the client was
  built now, against a written contract, behind one swappable source; its addenda record
  every contract ambiguity and architecture decision this phase settled.
- [`results.md`](../../docs/phase-3-web-client/results.md) — the recorded frame-timing
  and 400px-layout measurements, with environment capture and raw-file citations for
  every number.
