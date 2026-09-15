# Task 02 — `MarketDataSource`, Simulated Source, Dispatcher & Store

| | |
|---|---|
| **Phase** | 3 — Market Watch Web Client |
| **Status** | Not started |
| **Depends on** | 01 |
| **Blocks** | 04, 05, 06, 08 |
| **Parallel with** | 03 |
| **Owns** | `src/data/MarketDataSource.ts`, `src/data/SimulatedSource.ts`, `src/data/TickDispatcher.ts`, `src/data/store.ts`, `src/data/config.ts`, `public/symbols.json` |

> **Read [`client-contract.md`](client-contract.md) first.** You are implementing the
> client side of it twice over: once for real (task 08's `TckrGatewaySource`) and once in
> the browser (yours). Your interface is what makes those interchangeable.
>
> **State of the tree when you start:** task 01 has produced the project, the contract
> types, `decimal.ts` and the fixtures. Nothing under `src/data/`, `src/pages/`,
> `src/chart/` or `src/components/` exists.

---

## Where this fits in Phase 3

```text
  contracts (01) ─────────────┐
                              ▼
        ┌──────────── you are here ─────────────┐
        │  MarketDataSource  ◀── the seam        │
        │      ├── SimulatedSource   (yours)     │
        │      └── TckrGatewaySource (task 08)   │
        │  TickDispatcher ──▶ store              │
        └───────────────────┬───────────────────┘
                            │ useSyncExternalStore selectors
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
   StockList (04)    PriceChart (05)   StockDetail (06)
```

The other eight tasks: **01** contract types and fixtures (done before you start) ·
**03** shell, routes, banner · **04** stock list · **05** uPlot chart · **06** detail page
· **07** connection status, stream badge, backoff · **08** the real gateway source and the
conformance suite that runs the *same* page tests against your source and theirs · **09**
docs and the recorded perf run.

**Your interface is the phase's central claim.** ADR 006 promises that swapping to the
real gateway is one environment variable. That promise is kept or broken in
`MarketDataSource.ts`: anything the UI needs that is not on this interface becomes a
component that knows which source it is talking to.

---

## Objective

Define the single seam through which all market data reaches the UI, implement the
browser-side simulated source behind it, and make the render path survive a hot symbol by
coalescing ticks per animation frame into a store that re-renders one row rather than the
tree.

---

## Why this matters

Two failures live here.

The first is architectural: a source-shaped API that leaks its implementation. If
`SimulatedSource` exposes `setRate()` and the UI calls it, then the gateway source needs a
`setRate()` too, and the seam has become a lie. Everything specific to the simulator lives
behind its constructor, not on the interface.

The second is mechanical. A 25,000/sec tape with the mock exchange's real skew puts ~15%
of the tape — about 3,750 ticks/sec — through the single hottest symbol. One React state
update per tick is ~3,750 renders/sec of a list that can paint at 60. The tab does not
crash; it degrades into unresponsiveness, which is worse because it looks like a slow
network. Coalescing is not an optimisation here, it is the render contract: **the newest
tick per symbol per frame, and nothing else.**

---

## Specification

### `MarketDataSource.ts` — the seam

```ts
export interface MarketDataSource {
  connect(): Promise<void>;
  disconnect(): void;
  subscribe(symbols: readonly string[]): void;
  unsubscribe(symbols: readonly string[]): void;
  getUniverse(): Promise<SymbolUniverseResponse>;
  getSnapshot(symbol: string): Promise<Snapshot>;
  readonly on: {
    tick(h: (t: Tick) => void): () => void;          // every handler returns its unsubscribe
    snapshot(h: (s: Snapshot) => void): () => void;
    status(h: (s: ConnectionState) => void): () => void;
    error(h: (e: ErrorMsg) => void): () => void;
    entitlement(h: (e: EntitlementChanged) => void): () => void;
  };
  readonly identity: () => Identity | null;          // null until `connected` arrives
}

export interface Identity { readonly userId: string; readonly stream: Stream; readonly sessionId: string }

export type ConnectionState =
  | { readonly kind: 'connecting'; readonly attempt: number }
  | { readonly kind: 'connected'; readonly since: number }
  | { readonly kind: 'reconnecting'; readonly attempt: number; readonly nextRetryMs: number }
  | { readonly kind: 'closed'; readonly code: CloseCode; readonly reason: string };
```

`identity()` is the **only** way any component learns whether it is on LIVE or DELAYED,
and it is populated from the server's `connected` message. There is no setter (FR-6).

### `config.ts`

```ts
export interface ClientConfig {
  readonly source: 'simulated' | 'gateway';   // VITE_TCKR_SOURCE, default 'simulated'
  readonly gatewayUrl: string;                // VITE_TCKR_GATEWAY_URL, default 'ws://localhost:5000'
  readonly demoUser: string;                  // VITE_TCKR_USER, default 'user-001'
  readonly simulated: {
    readonly eventsPerSecond: number;         // VITE_TCKR_SIM_RATE, default 2000
    readonly delayedOffsetMs: number;         // VITE_TCKR_SIM_DELAY_MS, default 15000
    readonly seed: number;                    // VITE_TCKR_SIM_SEED, default 20260912
  };
}
export function createMarketDataSource(cfg?: Partial<ClientConfig>): MarketDataSource;
```

`createMarketDataSource` is the **only** place either implementation is named. A
`grep -rn "SimulatedSource\|TckrGatewaySource" src/` outside `src/data/` must return
nothing — task 08's conformance suite depends on this being true.

### `public/symbols.json`

A **verbatim copy** of `src/Tckr.MockExchange/Reference/symbols.json` — byte for byte,
disclaimer included. Do not reformat it, do not strip the `_disclaimer`, do not invent a
symbol. It carries 34 named instruments (`symbol`, `name`, `referencePrice`, `tickSize`,
`lotSize`, `weight`) and the client uses exactly those 34; the exchange's synthetic
padding to 250 is not represented client-side.

### `SimulatedSource.ts`

A believable tape, not a correct one. Behaviour:

- **Universe** from `public/symbols.json`; `getUniverse()` returns it as
  `SymbolUniverseResponse` with `simulated: true`.
- **Selection** weighted by each symbol's `weight`, normalised across the 34 — reproducing
  the exchange's skew, where COMI takes ~15% and the top ten ~59% of the tape.
- **Price walk** per symbol from `referencePrice`, moving 0–3 ticks of that symbol's own
  `tickSize`, mean-reverting toward the reference so prices wander rather than drift away.
  All arithmetic through `decimal.ts`; a price never becomes a `number`.
- **Message mix** 40% `TRADE`, 30% `BID`, 30% `ASK`, matching the exchange's
  `GenerationOptions` defaults.
- **Rate** `eventsPerSecond` across the universe, emitted in `setInterval` batches, not
  per-tick timers.
- **Seeded** — a small xorshift/mulberry32 PRNG, not `Math.random()`. Same seed, same tape.
- **DELAYED** is a delay buffer: when `identity().stream === 'DELAYED'`, ticks are held
  `delayedOffsetMs` before being emitted, with `t` (the exchange timestamp) **unchanged**.
  This is the simulation artifact named in the contract §5 — the real delay is 15 minutes
  and server-side. Expose `delayedOffsetMs` on the universe response's `simulated` metadata
  so task 03's banner and task 07's badge can label it.
- **Entitlement** derived from `demoUser`: `user-001` → LIVE, `user-002` → DELAYED. Emits
  `connected` on `connect()`. `entitlementChanged` is emitted if `demoUser` changes at
  runtime — the hook task 07 needs to test the transition.
- **Snapshots** computed from current per-symbol state; `getSnapshot` resolves on the next
  batch boundary, never synchronously, so task 06 cannot accidentally depend on ordering
  that the real gateway will not honour.

### `TickDispatcher.ts`

```ts
export class TickDispatcher {
  constructor(scheduleFrame?: (cb: () => void) => void);  // injectable for tests; defaults to requestAnimationFrame
  push(tick: Tick): void;      // O(1); overwrites any pending tick for that symbol
  flushNow(): void;            // test hook
  readonly stats: { received: number; flushed: number; coalesced: number };
}
```

Latest-value-wins per symbol per frame (NFR-3.1) — **display only**; the delayed tape
itself is never coalesced. `stats` is what task 09's DoD reads.

### `store.ts`

An external store for `useSyncExternalStore`, with **per-symbol subscriptions**:

```ts
export function subscribeSymbol(symbol: string, cb: () => void): () => void;
export function getSymbolSnapshot(symbol: string): SymbolView | undefined;  // stable reference between changes
export function getSymbolList(): readonly string[];                          // stable reference between changes
export interface SymbolView {
  readonly symbol: string; readonly name: string;
  readonly price: DecimalString; readonly change: DecimalString;
  readonly changePercent: number; readonly volume: number;
  readonly lastUpdate: number; readonly stream: Stream;
}
```

`getSymbolSnapshot` must return the **same object reference** until that symbol changes —
a new object every call makes `useSyncExternalStore` loop infinitely. This is the single
most common way to get this pattern wrong; there is a test for it below.

---

## Inputs you can rely on

From task 01, already on disk:

```ts
// src/contracts/messages.ts
export type Stream = 'LIVE' | 'DELAYED';
export type TickKind = 'TRADE' | 'BID' | 'ASK';
export interface Tick { readonly v: 1; readonly type: 'tick'; readonly s: string;
  readonly p: DecimalString; readonly q: number; readonly k: TickKind;
  readonly t: IsoUtc; readonly id: string; readonly st: Stream }
export type ServerMessage = Connected | Subscribed | Unsubscribed | Tick
                          | SnapshotMsg | Heartbeat | ErrorMsg | EntitlementChanged;
export function parseServerMessage(raw: string): ServerMessage;

// src/contracts/decimal.ts
export type DecimalString = string & { readonly [brand]: 'decimal' };
export function toDecimal(raw: string): DecimalString;
export function compare(a: DecimalString, b: DecimalString): -1 | 0 | 1;
export function subtract(a: DecimalString, b: DecimalString): DecimalString;
export function percentChange(from: DecimalString, to: DecimalString): number;
export function format(value: DecimalString, opts?: { decimals?: number; sign?: boolean }): string;

// src/contracts/rest.ts
export interface SymbolDefinition { symbol: string; name: string; referencePrice: DecimalString;
  tickSize: DecimalString; lotSize: number; weight: number }
export interface SymbolUniverseResponse { v: 1; asOf: IsoUtc; simulated: boolean;
  symbols: readonly SymbolDefinition[] }
export interface Snapshot { /* contract §2 */ }
```

Read task 01's *Notes for other tasks* for anything it changed.

---

## Constraints

- Prices are `DecimalString` end to end; no `parseFloat`, no `Number(price)`.
- No component may import a concrete source — only `createMarketDataSource`.
- `Math.random()` is banned in `SimulatedSource`; the tape is seeded and reproducible.
- No unbounded collections: per-symbol state is one record per symbol, and the dispatcher
  holds at most one pending tick per symbol.
- Nothing in `src/data/` imports React except `store.ts`'s types.

## Out of scope

`TckrGatewaySource` (task 08), any component or page, the chart, styling. You may add
nothing to `src/contracts/`; if you need a type there, request it in *Notes*.

---

## Tests

`src/data/__tests__/`:

| Test | Asserts |
|---|---|
| `universe.parity.test.ts` | `public/symbols.json` is byte-identical to `src/Tckr.MockExchange/Reference/symbols.json` (read both from disk, compare buffers) and yields exactly 34 instruments |
| `simulated.determinism.test.ts` | same seed → identical first 10,000 ticks (symbol, price, kind, quantity); different seed → different |
| `simulated.skew.test.ts` | over 100,000 ticks the top-1 share is 12–18% and the top-10 share 50–68%, bracketing the exchange's measured 14.4% / 59.1% |
| `simulated.prices.test.ts` | every emitted price is a valid `DecimalString` on that symbol's tick grid, and no single step exceeds 3 ticks |
| `simulated.mix.test.ts` | over 100,000 ticks the mix is 40/30/30 ±2pp |
| `simulated.delayed.test.ts` | with `demoUser=user-002`, a tick emitted at T reaches the handler at ≥ T + `delayedOffsetMs` (fake timers) and its `t` field is unchanged |
| `dispatcher.coalescing.test.ts` | 3,750 ticks pushed between two frames produce **exactly 1** flush for that symbol, `stats.coalesced === 3749`, and a ratio ≥50x over a 60-frame run |
| `dispatcher.latest-wins.test.ts` | the flushed value is the last pushed, never an earlier one |
| `store.stability.test.ts` | `getSymbolSnapshot` returns an identical reference across calls with no intervening tick, and a new reference after one |
| `store.isolation.test.ts` | a tick for COMI notifies only COMI's subscriber; CIB's callback is not invoked |
| `config.factory.test.ts` | `VITE_TCKR_SOURCE=gateway` yields a `TckrGatewaySource`-shaped object without constructing a socket; default yields the simulated one |

---

## Definition of done

- [ ] `npm run typecheck && npm test` exit 0; the eleven test files above all exist and pass.
- [ ] `cmp client/Tckr.MarketWatch/public/symbols.json src/Tckr.MockExchange/Reference/symbols.json`
      exits 0 — **byte-identical, disclaimer included**.
- [ ] `dispatcher.coalescing.test.ts` reports the measured ratio in its assertion message;
      paste the number into *Notes for other tasks*.
- [ ] `grep -rn "SimulatedSource\|TckrGatewaySource" src/ --include=*.ts --include=*.tsx | grep -v "^src/data/"`
      returns nothing.
- [ ] `grep -rn "Math.random" src/data/` returns nothing.
- [ ] `grep -rnE "parseFloat|Number\(" src/data/` returns nothing on any price path.
- [ ] `MarketDataSource` has no method whose name or behaviour is specific to either
      implementation — read the interface and confirm every member is meaningful for a
      real gateway.
- [ ] The simulated `delayedOffsetMs` default is 15000, is exposed on the universe
      response, and is documented in *Notes* as the contract §5 artifact it is.
- [ ] `identity()` returns `null` before `connected` and the server-supplied `Stream`
      after; no exported function anywhere in `src/data/` sets a stream from client input.

## Verification

```bash
cd client/Tckr.MarketWatch
npm run typecheck && npm test
cmp public/symbols.json ../../src/Tckr.MockExchange/Reference/symbols.json && echo "universe: identical"
grep -rn "Math.random" src/data/ ; grep -rn "SimulatedSource\|TckrGatewaySource" src/ --include=*.tsx
```

## Notes for other tasks

<!-- Fill in: the exact store and dispatcher API tasks 04/05/06 code against, the
     measured coalescing ratio and skew numbers, and anything you needed from task 01
     that was missing. -->
