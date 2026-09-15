# Task 01 — Scaffold, Contract Types, Decimal Helpers & Fixtures

| | |
|---|---|
| **Phase** | 3 — Market Watch Web Client |
| **Status** | Not started |
| **Depends on** | — |
| **Blocks** | 02, 03, 08 (everything) |
| **Parallel with** | — (this is wave 1, alone) |
| **Owns** | `client/Tckr.MarketWatch/package.json`, `tsconfig*.json`, `vite.config.ts`, `index.html`, `.gitignore`, `src/contracts/**`, `perf/playwright.config.ts` |

> **Read [`client-contract.md`](client-contract.md) before writing a line.** This task
> turns that document into TypeScript. Where this brief and the contract disagree, the
> contract wins and you record the discrepancy in *Notes for other tasks*.
>
> **State of the tree when you start:** `client/` exists and is empty. Node v24.18.0,
> npm 11.16.0. No JavaScript tooling exists anywhere in the repository yet — you are
> creating the first of it.

---

## Where this fits in Phase 3

```text
             ┌──────────── you are here ────────────┐
             │  contracts/  types · decimal · fixtures │
             └───────────────────┬──────────────────┘
                                 │ every other task imports these
                    ┌────────────┴────────────┐
                    ▼                         ▼
        MarketDataSource (02)          TckrGatewaySource (08)
                    │                         │
        SimulatedSource (02)          conformance suite (08)
                    │
        store + TickDispatcher (02)
                    │
      ┌─────────────┼─────────────┐
      ▼             ▼             ▼
 StockList (04) PriceChart (05) StockDetail (06)
      shell + banner (03) · connection UI (07) · docs + perf (09)
```

The other eight tasks in one line each:

| # | Produces |
|---|---|
| 02 | `MarketDataSource` interface, the browser `SimulatedSource`, the coalescing `TickDispatcher`, the external store, and `config.ts` |
| 03 | App shell, routes `/` and `/symbols/:symbol`, theme, permanent simulated banner |
| 04 | The stock list page |
| 05 | The uPlot price-vs-time chart |
| 06 | The stock detail page — snapshot, then stream |
| 07 | Connection status, stream badge, reconnect backoff, close-code handling |
| 08 | `TckrGatewaySource` (real contract, dormant until Phase 11) and the conformance suite |
| 09 | Client README, the recorded Playwright perf run, `results.md` |

**Nothing else exists yet.** You have no upstream dependencies and no interfaces to
consume. Every other task consumes yours, so a mistake here is the most expensive
mistake available in this phase.

---

## Objective

Stand up the client project, and turn contract v1 into types that make the phase's rules
unbreakable at compile time: a price cannot be a `number`, an outbound message cannot
carry a stream, and a message type cannot exist without a fixture proving its shape.

---

## Why this matters

Every downstream task will hold a price, format it, compare it and plot it. If the type
of a price is `number`, `85.42` becomes `85.41999999999999` somewhere between the socket
and the screen, and no later task can undo it — they will all have been written against
the wrong type. The same is true of the FR-6 rule: if the outbound message type is
`{ type: string; [k: string]: unknown }`, then task 08 *can* send a `stream` field, and
the single most important security property of the system depends on nobody doing so by
accident.

The naive scaffold is `npm create vite@latest` plus `interface Tick { price: number }`.
It costs nothing today and makes both properties unenforceable for the rest of the phase.

---

## Specification

### Project

```text
client/Tckr.MarketWatch/
├── package.json  tsconfig.json  tsconfig.node.json  vite.config.ts  index.html  .gitignore
├── perf/playwright.config.ts
└── src/contracts/{messages.ts, rest.ts, decimal.ts, closeCodes.ts, fixtures/}
```

Dependencies — pin exact versions, no `^`:

| | |
|---|---|
| runtime | `react` 19.x, `react-dom` 19.x, `react-router-dom` 7.x, `uplot` 1.6.x |
| dev | `typescript` 5.x, `vite` 7.x, `@vitejs/plugin-react`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@playwright/test` |

Scripts: `dev`, `build`, `preview`, `typecheck` (`tsc --noEmit`), `test` (`vitest run`),
`test:watch`, `test:perf` (`playwright test -c perf/playwright.config.ts`).

`tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`,
`exactOptionalPropertyTypes: true`, `verbatimModuleSyntax: true`, target ES2022.

### `src/contracts/decimal.ts`

A price is a branded string. This is the whole point of the module.

```ts
declare const brand: unique symbol;
export type DecimalString = string & { readonly [brand]: 'decimal' };

export function toDecimal(raw: string): DecimalString;      // validates /^-?\d+(\.\d{1,4})?$/, throws otherwise
export function isDecimal(raw: string): raw is DecimalString;
export function compare(a: DecimalString, b: DecimalString): -1 | 0 | 1;
export function subtract(a: DecimalString, b: DecimalString): DecimalString;
export function percentChange(from: DecimalString, to: DecimalString): number; // presentational only
export function format(value: DecimalString, opts?: { decimals?: number; sign?: boolean }): string;
```

Arithmetic works on scaled integers parsed from the string parts (4 implied decimals,
matching `PriceScale` on the exchange wire), never via `parseFloat`. `percentChange`
returns a `number` and is the **only** function permitted to — a percentage is
presentational and never round-trips into a price.

### `src/contracts/messages.ts`

Exactly the messages in the contract, no more. Every server message is a member of one
discriminated union, and every client message of another.

```ts
export type Stream = 'LIVE' | 'DELAYED';
export type TickKind = 'TRADE' | 'BID' | 'ASK';
export type IsoUtc = string & { readonly __iso: unique symbol };

export interface Tick {
  readonly v: 1; readonly type: 'tick';
  readonly s: string;            // symbol
  readonly p: DecimalString;     // price
  readonly q: number;            // quantity
  readonly k: TickKind;
  readonly t: IsoUtc;            // exchangeTimestamp, preserved end to end
  readonly id: string;           // eventId
  readonly st: Stream;
}

export interface Connected      { readonly v: 1; readonly type: 'connected'; readonly userId: string;
                                  readonly stream: Stream; readonly sessionId: string;
                                  readonly heartbeatIntervalMs: number; readonly serverTime: IsoUtc }
export interface Subscribed     { readonly v: 1; readonly type: 'subscribed'; readonly requestId?: string;
                                  readonly stream: Stream; readonly accepted: readonly string[];
                                  readonly rejected: readonly string[] }
export interface Unsubscribed   { readonly v: 1; readonly type: 'unsubscribed'; readonly requestId?: string;
                                  readonly accepted: readonly string[] }
export interface SnapshotMsg    { readonly v: 1; readonly type: 'snapshot'; readonly snapshot: Snapshot }
export interface Heartbeat      { readonly v: 1; readonly type: 'heartbeat'; readonly serverTime: IsoUtc }
export interface ErrorMsg       { readonly v: 1; readonly type: 'error'; readonly code: ErrorCode;
                                  readonly message: string; readonly requestId?: string }
export interface EntitlementChanged { readonly v: 1; readonly type: 'entitlementChanged';
                                  readonly stream: Stream; readonly resubscribeRequired: boolean;
                                  readonly effectiveFrom: IsoUtc }

export type ServerMessage = Connected | Subscribed | Unsubscribed | Tick
                          | SnapshotMsg | Heartbeat | ErrorMsg | EntitlementChanged;

export type ErrorCode = 'UNKNOWN_SYMBOL' | 'SUBSCRIPTION_LIMIT' | 'NOT_ENTITLED'
                      | 'RATE_LIMITED' | 'INTERNAL';

// Outbound. There is deliberately no stream, tier, delay or userId field anywhere here.
export type ClientMessage =
  | { readonly type: 'subscribe';   readonly symbols: readonly string[]; readonly requestId?: string }
  | { readonly type: 'unsubscribe'; readonly symbols: readonly string[]; readonly requestId?: string }
  | { readonly type: 'ping';        readonly requestId?: string };

export function parseServerMessage(raw: string): ServerMessage;  // throws on unknown type or bad shape
```

`parseServerMessage` validates the discriminant and the required fields, converts price
fields through `toDecimal`, and **ignores unknown fields** rather than failing on them —
the contract's forward-compatibility rule.

### `src/contracts/rest.ts`

`SymbolDefinition`, `SymbolUniverseResponse` and `Snapshot`, matching contract §2 field
for field. `referencePrice`, `tickSize`, `price`, `change`, `open`, `high`, `low` are all
`DecimalString`; `lotSize`, `volume` and `snapshotAge` are `number`; `simulated` is
`boolean`.

### `src/contracts/closeCodes.ts`

```ts
export const CloseCode = { Normal: 1000, Unauthenticated: 4401, TokenExpired: 4403,
                           HeartbeatTimeout: 4408, SlowConsumer: 4429 } as const;
export type CloseCode = (typeof CloseCode)[keyof typeof CloseCode];
```

### `src/contracts/fixtures/`

One `.json` file per case, plus `index.ts` exporting them as a typed map. Minimum set —
every one of these is consumed by task 08's conformance suite:

`connected-live`, `connected-delayed`, `subscribed-all-accepted`,
`subscribed-partial-reject`, `unsubscribed`, `tick-trade`, `tick-bid`, `tick-ask`,
`tick-delayed`, `snapshot-live`, `snapshot-delayed`, `heartbeat`,
`error-unknown-symbol`, `error-subscription-limit`, `error-not-entitled`,
`error-rate-limited`, `error-internal`, `entitlement-upgraded`,
`entitlement-downgraded`, `symbols-universe`.

`index.ts` also exports `ALL_SERVER_MESSAGE_TYPES: readonly ServerMessage['type'][]` and
`ALL_ERROR_CODES: readonly ErrorCode[]`, derived from the types, so the coverage test
below cannot silently pass when a message is added later.

---

## Inputs you can rely on

None. You are wave 1. Your only source of truth is
[`client-contract.md`](client-contract.md) and, for the universe shape,
`src/Tckr.MockExchange/Reference/symbols.json` (task 02 copies it; you only need its
field names for `rest.ts`).

---

## Constraints

- Prices are `DecimalString` everywhere. `percentChange` is the only function returning a
  `number` from price input.
- No outbound message type may carry a stream, tier, delay or user field (FR-6).
- `strict` TypeScript, no `any` outside the fixture loader.
- Exact dependency versions, no ranges.
- The client is usable at 400px; set the viewport meta now so later tasks inherit it.

## Out of scope

Components, routing, styling, any data source, anything under `src/data/`, `src/pages/`,
`src/chart/` or `src/components/`. You produce types and tooling, not UI.

---

## Tests

`src/contracts/__tests__/`:

| Test | Asserts |
|---|---|
| `decimal.roundtrip.test.ts` | `format(toDecimal(x)) === x` for a table of 4dp values including `0.0001`, `-3.5`, `999999.9999` |
| `decimal.arithmetic.test.ts` | `subtract`/`compare` correct across sign changes and carries; `subtract('0.30','0.10') === '0.20'` exactly (the case `parseFloat` fails) |
| `decimal.validation.test.ts` | `toDecimal` throws on `'1.23456'`, `'abc'`, `''`, `'1,23'`, `'NaN'`, `'1e3'` |
| `decimal.no-float.test.ts` | the source of `decimal.ts` contains no `parseFloat`, no `Number(`, no `+x` coercion (read the file, assert by regex) |
| `messages.parse.test.ts` | every fixture parses; an unknown `type` throws; an unknown *field* does not |
| `messages.coverage.test.ts` | every member of `ALL_SERVER_MESSAGE_TYPES` has ≥1 fixture, and every `ALL_ERROR_CODES` member has one — **this is the test that fails when someone adds a message and forgets the fixture** |
| `messages.outbound.test.ts` | `ClientMessage` admits no `stream`/`tier`/`userId` key — a `@ts-expect-error` block plus a runtime check that the serializer drops unknown keys |

---

## Definition of done

Every box is checkable by running something or opening a named file. Nothing here is a
matter of opinion.

- [ ] `cd client/Tckr.MarketWatch && npm ci && npm run build` exits 0.
- [ ] `npm run typecheck` exits 0 with `strict`, `noUncheckedIndexedAccess` and
      `exactOptionalPropertyTypes` all `true` in `tsconfig.json`.
- [ ] `npm test` exits 0 and reports **≥ 7 test files, 0 failures, 0 skipped**.
- [ ] `package.json` lists every dependency at an exact version — `grep -c '"\^' package.json`
      returns 0.
- [ ] `src/contracts/messages.ts` declares exactly 8 server message interfaces and a
      3-member `ClientMessage` union; `ServerMessage` has 8 members.
- [ ] The 20 fixtures named in the specification all exist under
      `src/contracts/fixtures/` and are exported from `index.ts`.
- [ ] `messages.coverage.test.ts` passes, and **fails when a fixture is deleted** —
      demonstrate by deleting one, running `npm test`, restoring it, and pasting both
      outcomes into *Notes for other tasks*.
- [ ] `decimal.no-float.test.ts` passes and `grep -nE 'parseFloat|Number\(' src/contracts/decimal.ts`
      returns nothing.
- [ ] `perf/playwright.config.ts` exists and `npx playwright test -c perf/playwright.config.ts --list`
      exits 0 (no specs yet is fine; task 09 adds them).
- [ ] `index.html` contains `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- [ ] A `.gitignore` in `client/Tckr.MarketWatch/` covering `node_modules/`, `dist/`,
      `playwright-report/`, `test-results/`.

## Verification

```bash
cd client/Tckr.MarketWatch
npm ci
npm run typecheck && npm run build && npm test
grep -c '"\^' package.json                      # expect 0
grep -nE 'parseFloat|Number\(' src/contracts/decimal.ts   # expect no output
npx playwright test -c perf/playwright.config.ts --list
```

## Notes for other tasks

<!-- Fill this in when the task is done: the exact exported surface tasks 02–09 code
     against, anything you changed from this brief and why, and any contract discrepancy
     you found. -->
