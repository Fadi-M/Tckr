---
name: gen-test
description: Draft a new vitest test for Tckr.MarketWatch, following the repo's established per-behavior test conventions rather than generic test scaffolding. Use when the user asks to add/write a test for a behavior in src/data, src/chart, src/components, or src/pages.
---

# gen-test

Write a vitest test for Tckr.MarketWatch (`client/Tckr.MarketWatch`) that fits this repo's
existing conventions. Ask the user which behavior/source file the test is for if it isn't
already clear from context.

## Before writing anything

1. Find the directory the behavior lives in (`src/data`, `src/chart`, `src/components`,
   `src/pages`, `src/contracts`) and read 2-3 existing `__tests__/*.test.ts(x)` files there.
2. Read that directory's shared test support file — `__tests__/testSupport.ts`, or the
   directory-specific equivalent (`chart/__tests__/testSupport.ts` +
   `chart/__tests__/uplotTestDouble.ts`, `src/test-support/FakeWebSocket.ts`,
   `src/contracts/fixtures/index.ts`). Reuse its fixtures/doubles rather than inventing new
   ones.

## Conventions to follow (do not deviate without a reason)

- **Name the file after the behavior, not the source module.** This repo's test names are
  kebab-ish dot notation describing what's being verified
  (`dispatcher.coalescing.test.ts`, `simulated.tape.test.ts`,
  `StockList.render-isolation.test.tsx`) and frequently do **not** share a basename with
  the source file: `TickDispatcher.ts` → `dispatcher.*.test.ts`, `SimulatedSource.ts` →
  `simulated.*.test.ts`, `TckrGatewaySource.ts` → the `conformance/` suite. Match the
  sibling tests' naming pattern in that directory.
- **One file per behavior, not per assertion.** First search for a file that already
  covers the behavior (`grep` the test id, the testid, the function name) and extend it.
  Add a file only for a behavior nothing covers. Never assert the same thing in two files.
- **Data-layer changes that both sources must honor identically belong in
  `src/data/__tests__/conformance/`** as one `describe.each` over both sources (see
  `conformance.entitlement-discard.test.ts`), never as two copies in per-source files.
- **Test the business and the load, not the markup.** Assert what a trader relies on
  (prices, LIVE/DELAYED, market hours, connection state) and what must hold under a hot
  symbol (coalescing, one tick one row, bounded buffers). Skip restating TypeScript's
  guarantees or a component's class names.
- **Prices are never floats** — anything price-shaped goes through
  `src/contracts/decimal.ts`; don't hand-roll a price as a raw JS number in a fixture.
- **jsdom only** (`vitest run`). Nothing here should assume a real browser — that's the
  separate, manually-run `perf/` Playwright suite.

## Workflow

1. Confirm the target behavior and directory with the user if ambiguous.
2. Read the sibling tests and support file (above).
3. Name the new file following the directory's existing naming pattern.
4. Write the test using the fixtures/doubles already established in that directory.
5. Run it: `npx vitest run <path-to-new-test>` from `client/Tckr.MarketWatch`. Run
   `npm run typecheck` too if the change touches shared types.
