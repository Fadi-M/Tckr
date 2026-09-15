# Task 06 — Stock Detail Page — Snapshot, Then Stream

| | |
|---|---|
| **Phase** | 3 — Market Watch Web Client |
| **Status** | Not started |
| **Depends on** | 02, 03 |
| **Blocks** | 07, 09 |
| **Parallel with** | 04, 05 |
| **Owns** | `src/pages/StockDetail.tsx`, `src/pages/__tests__/StockDetail.*.test.tsx` |

> **Read [`client-contract.md`](client-contract.md) §2 and §4 first.** The
> snapshot-then-stream order and the reconnect lifecycle you implement here are the
> client half of DS-3, and they are the behaviours the real gateway is being built to
> satisfy.
>
> **State of the tree when you start:** tasks 01–03 are done. Task 05's `PriceChart` may
> land in parallel — code against the props in *Inputs* and mount a placeholder until it
> exists.

---

## Where this fits in Phase 3

```text
   contracts (01) ──▶ data seam + store (02)
                            │
   app shell (03) ──────────┤
                            ▼
              ┌──────── you are here ─────────┐
              │  StockDetail  /symbols/:sym   │
              │   header stats · lifecycle    │
              └───────────────┬───────────────┘
                              │ mounts
                       PriceChart (05)
```

Others: **01** types · **02** the source and store · **03** the frame and tokens · **04**
the list that navigates here · **05** the chart you mount · **07** the connection status
and stream badge (they read the same `identity()` you do — do not duplicate their UI) ·
**08** the gateway source, whose conformance suite re-runs your tests against it · **09**
docs and the recorded perf run.

---

## Objective

Own one symbol's screen and its subscription lifecycle: paint from a snapshot before the
first tick arrives, stream from then on, and release the subscription cleanly when the
user leaves or switches symbol.

---

## Why this matters

This page is where the contract's recovery story is either honoured or quietly broken.
DS-3 says a reconnecting client takes a snapshot and resumes — it does **not** replay
missed ticks. A page that renders nothing until the first tick arrives looks broken for as
long as that symbol is quiet, which for a thin instrument can be minutes. A page that
paints from the snapshot first is correct *and* feels instant.

The lifecycle half is the one that leaks. Navigating COMI → CIB → ORAS while forgetting to
unsubscribe leaves three live subscriptions and a chart receiving another symbol's ticks.
Against the simulator that is invisible; against a real gateway it is a subscription leak
that survives until the socket closes. There is an explicit test for the A→B case below.

---

## Specification

### Mount sequence — the order is the requirement

```text
1. read :symbol from the route
2. source.getSnapshot(symbol)      ─┐  paint header + seed chart from this
3. source.subscribe([symbol])       │  ← after the snapshot request is issued
4. ticks flow into the store        │
5. header + chart update from store─┘
```

The snapshot must be *rendered* before the first tick is *applied*. If a tick arrives
while the snapshot is still in flight, it is applied after the snapshot, not discarded and
not overwritten by stale snapshot data — compare `exchangeTimestamp`/`lastUpdate` and keep
the newer.

### Unmount / symbol change

- Unmount: `source.unsubscribe([symbol])`.
- Symbol change (A → B): unsubscribe A **before** subscribing B, and reset the chart so
  no point from A appears on B's series.
- The effect's cleanup must be correct under React 19 StrictMode double-invocation — a
  double subscribe/unsubscribe pair must leave exactly one live subscription.

### Layout

```text
← back                                                     [stream badge slot (07)]
COMI  Commercial International Holding                     ● LIVE
85.42   +1.05  (+1.24%)                        as of 10:31:04 · simulated
┌──────────────────────────────────────────────────────────────────┐
│                        PriceChart (05)                           │
└──────────────────────────────────────────────────────────────────┘
open 84.37 · high 85.90 · low 84.10 · volume 216,637 · lot 100 · tick 0.05
```

- Prices render through task 04's `PriceCell` — reuse it, do not write a second formatter.
- `as of` shows the snapshot/tick `exchangeTimestamp`, **not** local receipt time. On a
  DELAYED stream this is the original exchange time (FR-4) and must be labelled as such,
  so a DELAYED viewer sees a timestamp 15 minutes behind the clock and understands why.
- Back navigation returns to `/` preserving the list's search and sort if trivially
  possible; if not, say so in *Notes* rather than adding state plumbing to task 04.
- Unknown symbol (not in the universe, or the source answers `UNKNOWN_SYMBOL`): render an
  explicit not-found state with a link back, never a blank page or a crash.

---

## Inputs you can rely on

From task 02 (confirm against its *Notes*):

```ts
export function createMarketDataSource(cfg?: Partial<ClientConfig>): MarketDataSource;
export function subscribeSymbol(symbol: string, cb: () => void): () => void;
export function getSymbolSnapshot(symbol: string): SymbolView | undefined;
export interface MarketDataSource {
  subscribe(symbols: readonly string[]): void; unsubscribe(symbols: readonly string[]): void;
  getSnapshot(symbol: string): Promise<Snapshot>; getUniverse(): Promise<SymbolUniverseResponse>;
  readonly on: { tick(h): () => void; snapshot(h): () => void; status(h): () => void;
                 error(h): () => void; entitlement(h): () => void };
  readonly identity: () => Identity | null;   // { userId, stream, sessionId } | null
}
```

From task 05:

```tsx
export function PriceChart(props: { symbol: string; tickSize: DecimalString;
                                    capacity?: number; height?: number }): JSX.Element;
```

From task 04: `PriceCell`. From task 01: `format`, `percentChange`, `DecimalString`.
From task 03: the page container and tokens.

`getSnapshot` resolves asynchronously **by design** (task 02 made it so deliberately) —
you may not assume a synchronous snapshot, because the real gateway will not give you one.

---

## Constraints

- Snapshot before first tick, always.
- Exactly one live subscription per mounted symbol, StrictMode included.
- Prices through `PriceCell`; timestamps are exchange time, labelled.
- No import of a concrete source; `identity()` is the only source of the stream value.
- No unbounded state — the chart owns the history, this page owns one symbol's current view.

## Out of scope

The chart internals (task 05), the stream badge and connection status components
(task 07 — you provide the slot), the list page, anything in `src/data/`.

---

## Tests

`src/pages/__tests__/`:

| Test | Asserts |
|---|---|
| `StockDetail.snapshot-first.test.tsx` | with a snapshot deferred 50ms and a tick arriving at 10ms, the snapshot's values render **before** the tick's, and the final state is the tick's (newer wins) |
| `StockDetail.subscribe-lifecycle.test.tsx` | `subscribe(['COMI'])` called once on mount; `unsubscribe(['COMI'])` once on unmount; under StrictMode double-invoke, net subscriptions = 1 |
| `StockDetail.symbol-switch.test.tsx` | navigating COMI → CIB calls `unsubscribe(['COMI'])` **before** `subscribe(['CIB'])`, and the chart is remounted/reset with no COMI point |
| `StockDetail.delayed-labelling.test.tsx` | with `identity().stream === 'DELAYED'`, the `as of` timestamp is the event's exchange time and the DELAYED context is stated on screen |
| `StockDetail.unknown-symbol.test.tsx` | `/symbols/NOPE` renders the not-found state with a working link back to `/` |
| `StockDetail.price-cell-reuse.test.tsx` | every price on the page is rendered by `PriceCell` (assert by component, not by string) |

---

## Definition of done

- [ ] `npm run typecheck && npm test` exit 0; the six test files above exist and pass.
- [ ] `StockDetail.snapshot-first.test.tsx` asserts *ordering*, not merely final state —
      the snapshot values must be observed in the DOM before the tick's.
- [ ] `StockDetail.subscribe-lifecycle.test.tsx` runs inside `<StrictMode>` and asserts
      net subscription count 1; paste the call log into *Notes*.
- [ ] `StockDetail.symbol-switch.test.tsx` asserts call **order** (unsubscribe before
      subscribe) via a shared spy, not two independent assertions.
- [ ] `grep -rn "SimulatedSource\|TckrGatewaySource" src/pages/StockDetail.tsx` returns nothing.
- [ ] `grep -rnE "toFixed|parseFloat|Number\(" src/pages/StockDetail.tsx` returns nothing.
- [ ] Navigating `/` → COMI → back → CIB in `npm run dev` leaves exactly one active
      subscription; demonstrate with a console counter and paste the output into *Notes*.
- [ ] At a 400px viewport the page shows the header stats, the chart and the footer
      stats with **no horizontal scrollbar** (`document.scrollingElement.scrollWidth <=
      innerWidth`, checked in the browser console); paste the two numbers into *Notes*.

## Verification

```bash
cd client/Tckr.MarketWatch
npm run typecheck && npm test -- StockDetail
npm run dev   # / → COMI → back → CIB; confirm chart resets and no stale ticks appear
VITE_TCKR_USER=user-002 npm run dev   # DELAYED: 'as of' runs behind the clock, and says why
```

## Notes for other tasks

<!-- Fill in: the slot task 07 mounts the badge into, the subscription call log, whether
     list state survives back-navigation, and anything missing from tasks 02/04/05. -->
