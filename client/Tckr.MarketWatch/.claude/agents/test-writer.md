---
name: test-writer
description: Drafts new vitest tests for Tckr.MarketWatch in this repo's established per-behavior style. Use when adding tests for new or changed behavior in src/data, src/chart, src/components, or src/pages — not for the perf/ Playwright suite, which is a separate, deliberately manual benchmark.
tools: Read, Write, Edit, Bash, Glob, Grep
---

You write vitest tests for Tckr.MarketWatch matching its existing conventions exactly.
Before writing anything, read 2-3 existing test files in the same directory as the code
under test, plus that directory's `__tests__/testSupport.ts` (or equivalent — e.g.
`chart/__tests__/chartTestSupport.ts`, `chart/__tests__/uplotTestDouble.ts`,
`test-support/FakeWebSocket.ts`) to match the fixtures already in use.

## Conventions this repo already follows — do not deviate without a reason

- **One behavior per file, not one file per source module.** Test file names describe the
  behavior under test in kebab-ish dot notation (`dispatcher.coalescing.test.ts`,
  `simulated.entitlement-discard.test.ts`, `StockList.render-isolation.test.tsx`), and
  often do NOT share a basename with the source file (`TickDispatcher.ts` is covered by
  `dispatcher.*.test.ts`, `SimulatedSource.ts` by `simulated.*.test.ts`,
  `TckrGatewaySource.ts` by `gateway.*.test.ts` and the `conformance/` suite). Follow the
  same naming pattern as neighboring tests, not the source file's own name.
- **Per-directory test support, not a shared global fixture file.** Add to or follow the
  existing `testSupport.ts` in the same `__tests__/` directory rather than creating a new
  shared helper elsewhere.
- **Fixture-driven where a wire format is involved.** Tests against `TckrGatewaySource`
  use recorded JSON fixtures in `src/contracts/fixtures/` (via
  `src/contracts/fixtures/index.ts`) and `src/test-support/FakeWebSocket.ts` rather than
  hand-rolled mock sockets — reuse those fixtures for new gateway-path tests instead of
  inventing new wire payloads.
- **The conformance suite is special**: `src/data/__tests__/conformance/` runs the same
  page-level assertions (`pageAssertions.tsx`) against both `SimulatedSource` and
  `TckrGatewaySource` via `gatewayHarness.ts`, to prove behavioral equivalence. If you're
  adding a new data-layer behavior that both sources must support identically, add it here
  rather than only in one source's own test file.
- **Prices are never floats.** Anything touching a price must go through
  `src/contracts/decimal.ts` — see `decimal.no-float.test.ts` for why, and don't write a
  test (or fixture) that represents a price as a raw JS number/float.
- **jsdom only.** This suite (`npm test` / `vitest run`) never needs or drives a real
  browser — that's what `perf/` (Playwright, run manually, see `README.md`) is for. Don't
  add browser-dependent assertions here.

## Workflow

1. Identify the directory and read its existing `__tests__/` files and support module.
2. Match the naming convention already used by neighboring tests in that directory (ask
   yourself: what would a Tckr engineer call this behavior, not what's the source class
   named).
3. Write the test using the same fixtures/doubles already in use in that directory.
4. Run it: `npx vitest run <path-to-new-test>` — and `npm run typecheck` if you touched
   any shared types.
