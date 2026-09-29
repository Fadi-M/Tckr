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

## The rules, and the workflow around them

`GUIDELINES.md` is the single source of truth for rules and the definition of done. It is
imported here so it is always in context:

@GUIDELINES.md

For every code, UI, docs, or config task in this package:

1. **Start** with the `preflight` skill. It classifies the task against GUIDELINES.md and
   plans the reviews.
2. **Plan** (plan mode for anything non-trivial), then build in small, test-green steps.
   A PostToolUse hook typechecks and lints each edited file.
3. **Finish** with the `postflight` skill before reporting done. A Stop hook
   (`.claude/hooks/stop-definition-of-done.sh`) also blocks ending a turn while typecheck,
   lint, or tests fail on changed code.

Path-scoped rules in `.claude/rules/` add area-specific notes for `src/data`, the chart and
render path, and motion. Vendored skills are listed in `.claude/skills/VENDORED.md`.

## Commands

The scripts are in `package.json`; run them from this directory. `npm run check` runs
everything CI runs (typecheck, lint, test, build, bundle budget).

`npm run dev` goes through `scripts/dev.mjs`, which passes every other argument to Vite.
`npm run dev:open` (12:00 Cairo) and `npm run dev:bell` (09:59:45 Cairo) run the app on a
simulated clock during EGX trading hours; for any other Cairo time use
`npm run dev -- --market HH:MM[:SS]` (see README, "Testing during EGX trading hours"). Use
these to check anything that only happens while the market is open (ticks, re-ranks, the
opening bell, the close).

Performance tests (`perf/frame-timing.spec.ts`, `perf/layout-400.spec.ts`) are **not** run
in the normal test suite or CI — they need a real Chromium and a built app, and are run
deliberately because frame timing is a noisy, environment-sensitive signal:

```bash
npx playwright install chromium   # once
npm run build
npm run test:perf
```

## Architecture — why the rules are shaped this way

The rules themselves are GUIDELINES.md §1; this is the context behind the non-obvious ones.

- **Why `reconnectSharedSource()` and never a bare `.connect()`.** `getSharedSource()`
  calls `.connect()` exactly once at first access, which is what makes it safe under React
  StrictMode's double-invoked effects. `TckrGatewaySource.connect()`'s guard (`#socket`'s
  `readyState`) does not cover the `reconnecting` state, so a direct call there would race
  the pending backoff timer and open a second socket. `reconnectSharedSource()` disconnects
  first, which cancels any pending backoff timer on either implementation. The only caller
  is StockList's `ConnectionBanner` "Retry now"/"Reconnect".
- **Why `App.tsx` stays data-free.** It only renders `StockList`/`StockDetail`, which own
  their own data wiring, and receives already-resolved presentational props (e.g.
  `simulated`) from `main.tsx`, the composition root.
- **Why the lazy chunks.** `StockDetail` (and so `uplot`) is lazy-loaded from `App.tsx` so
  list-only visitors never download the chart library. GSAP gets the same treatment through
  `src/motion/gsap.ts` → `loadMotion()`/`useMotion()` (preloaded at idle from `main.tsx`); a
  static import anywhere else silently moves ~43 KB gzip into the entry chunk, which is also
  why `@gsap/react`'s `useGSAP` is not used. `src/__tests__/bundle.footprint.test.ts` walks
  the entry's static import graph on every `npm test` and names the import that breaks
  this; `npm run check:bundle` measures the built size. Motion tests use
  `src/motion/__tests__/motionTestSupport.ts` (`primeMotion`, then assert a moment's first
  frame synchronously; `finishMotion` for its end state).

### Directory map (non-obvious parts only)

- `src/contracts/` — the wire contract (`messages.ts`, `rest.ts`, `decimal.ts`,
  `closeCodes.ts`) plus recorded fixture JSON in `contracts/fixtures/`, used both to
  validate `TckrGatewaySource` and to drive the conformance suite below.
- `src/data/__tests__/conformance/` — runs the *same* page-level test suite against both
  `SimulatedSource` and `TckrGatewaySource`. If you change data-layer behavior, expect this
  suite to be the one that catches a simulated/gateway divergence.
- `src/data/__mocks__/config.ts` — Vitest's automatic mock for `config.ts`: page and
  component suites call `vi.mock('…/data/config.ts')` with no factory and point
  `getSharedSource()` at a fake per test.
- `src/test-support/FakeWebSocket.ts` — the fake WS used to fixture-test
  `TckrGatewaySource` without a real gateway (Phase 11 hasn't built one yet).
- `src/display/` — the one formatter per displayed quantity (`percent.ts`) and the shared
  display cadence (`throttle.ts`).
- `scripts/check-bundle.mjs` — the entry-chunk budget, lazy-library and CSP checks.
- `vite.config.ts` — also generates the production Content-Security-Policy (build only).

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
- `DESIGN.md` / `PRODUCT.md` — the visual system and product constraints (impeccable reads
  both).
