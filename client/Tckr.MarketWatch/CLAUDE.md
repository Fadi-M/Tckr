# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Phase 3 of the Tckr project: a React 19 + TypeScript + Vite client for Tckr's market-data
contract (searchable instrument list, per-symbol streaming chart, LIVE/DELAYED labelling
sourced only from the server). This directory (`client/Tckr.MarketWatch`) is a standalone
npm package nested inside the larger `Tckr` git repo — run all commands from here, not the
repo root.

All data in this app is currently simulated (`SimulatedSource`, a seeded in-browser random
walk) — there is no backend yet. See `README.md` for the full picture, including the
LIVE/DELAYED simulation story and the env-var table; this file only covers what a coding
agent needs that the README doesn't already say.

## Commands

```bash
npm run dev          # http://localhost:5173, hot-reloading
npm run typecheck    # tsc --noEmit (project is strict: true)
npm test             # vitest run — jsdom, no browser needed
npm run test:watch   # vitest watch mode
npm run build        # production build to dist/
npm run preview      # serve dist/ at http://localhost:4173
```

Run a single test file or a subset with vitest's normal filtering, e.g.:

```bash
npx vitest run src/data/__tests__/dispatcher.coalescing.test.ts
npx vitest run -t "coalesces"
```

Performance tests (`perf/frame-timing.spec.ts`, `perf/layout-400.spec.ts`) are **not** run
in the normal test suite or CI — they need a real Chromium and a built app, and are run
deliberately because frame timing is a noisy, environment-sensitive signal:

```bash
npx playwright install chromium   # once
npm run build
npm run test:perf
```

## Architecture — the one seam

```text
                          MarketDataSource            (interface, src/data/MarketDataSource.ts)
                                 ▲
                ┌────────────────┴────────────────┐
         SimulatedSource                    TckrGatewaySource
 (seeded random walk, in-browser)      (WebSocket + REST, client-contract.md v1;
                                         dormant until a gateway exists — Phase 11)
                └────────────────┬─────────────────┘
                                  ▼
                      config.ts: createMarketDataSource()
                      — the ONLY place either class is named —
                      wrapped by getSharedSource() into an
                      app-wide singleton (one connection, ever)
                                  │
                                  ▼
                           TickDispatcher
                (coalesces per symbol, flushes ≤1×/animation frame)
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

**The one seam that matters**: `src/data/config.ts`'s `createMarketDataSource()` is the
only place `SimulatedSource` or `TckrGatewaySource` is named. No page or component imports
either concrete class — only the `MarketDataSource` type and `getSharedSource()` /
`createMarketDataSource()` from `config.ts`. This is enforced by a test
(`grep -rn "SimulatedSource\|TckrGatewaySource" src/` outside `src/data/` must return
nothing), not just convention — don't break it when adding a new call site.

`getSharedSource()` owns connection lifecycle: it calls `.connect()` itself, exactly once,
at first access. Call sites must never call `.connect()` directly on the returned instance
— only `subscribe`/`unsubscribe`/`getUniverse`/`getSnapshot`, and read `identity()`/
`on.status` to observe health. This is deliberately safe under React StrictMode's
double-invoked effects. The one exception is a user-initiated manual retry (StockList's
`ConnectionBanner` "Retry now"/"Reconnect" buttons), which must go through
`reconnectSharedSource()` (also in `config.ts`) rather than a bare `.connect()` — a bare
call is not safe to expose to call sites, since `TckrGatewaySource.connect()`'s guard
(`#socket`'s `readyState`) does not cover the `reconnecting` state, where a direct
`.connect()` call would race the pending automatic backoff timer and open a second socket.
`reconnectSharedSource()` disconnects first (which cancels any pending backoff timer on
either implementation) so at most one connection is ever in flight.

`App.tsx` does not import anything from `src/data/**` (enforced by
`shell.no-data-import.test.ts`) — it only renders `StockList`/`StockDetail`, which own their
own data-layer wiring, and receives already-resolved presentational props (e.g. `simulated`)
from the composition root (`main.tsx`) rather than resolving config itself.

`StockDetail` (and therefore `uplot`) is lazy-loaded from `App.tsx` so the chart library is
never in the initial bundle for users who only visit the list page.

### Directory map (non-obvious parts only)

- `src/contracts/` — the wire contract (`messages.ts`, `rest.ts`, `decimal.ts`,
  `closeCodes.ts`) plus recorded fixture JSON in `contracts/fixtures/`, used both to
  validate `TckrGatewaySource` and to drive the conformance suite below. `decimal.ts`
  exists because prices must never go through float parsing — see its tests
  (`decimal.no-float.test.ts`) before touching anything on a price path.
- `src/data/__tests__/conformance/` — runs the *same* page-level test suite against both
  `SimulatedSource` and `TckrGatewaySource` to prove behavioural equivalence between them.
  If you change data-layer behavior, expect this suite to be the one that catches a
  simulated/gateway divergence.
- `src/test-support/FakeWebSocket.ts` — the fake WS used to fixture-test
  `TckrGatewaySource` without a real gateway (Phase 11 hasn't built one yet).
- Every module directory keeps its own `__tests__/testSupport.ts` (or equivalent, e.g.
  `chart/__tests__/chartTestSupport.ts`, `chart/__tests__/uplotTestDouble.ts`) rather than
  a shared global fixture file — follow that pattern for new test support code instead of
  centralizing it.

### Env-driven config

`resolveClientConfig()` in `src/data/config.ts` reads all `VITE_TCKR_*` env vars (source,
gateway URL, demo user, simulated rate/delay/seed) and fails fast if a production build
(`import.meta.env.PROD`) would silently ship the simulated source without an explicit
`VITE_TCKR_ALLOW_SIMULATED_IN_PROD=true` opt-in. See the table in `README.md` and the doc
comment at the top of `config.ts` for the full list — don't duplicate it here.

### Further reading

Don't re-derive this from source — it's written down:

- `docs/phase-3-web-client/client-contract.md` (repo root) — the frozen v1 wire contract.
- `docs/decisions/006-client-data-source-contract.md` (repo root) — why the client is built
  this way, and every contract ambiguity Phase 11's gateway implementer inherits (rate-limit
  backoff magnitude, unmapped close codes, resubscribe-on-entitlement-change, symbol
  ordering, the unwired heartbeat watchdog, etc.).
- `README.md` (this directory) — the full "swap to a real gateway" story and the
  what-changes/what-doesn't table.
