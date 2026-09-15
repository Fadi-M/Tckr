# Task 04 — Stock List Page

| | |
|---|---|
| **Phase** | 3 — Market Watch Web Client |
| **Status** | Not started |
| **Depends on** | 02, 03 |
| **Blocks** | 09 |
| **Parallel with** | 05, 06 |
| **Owns** | `src/pages/StockList.tsx`, `src/pages/__tests__/StockList.*.test.tsx`, `src/components/PriceCell.tsx` |

> **Read [`client-contract.md`](client-contract.md) §2 (`GET /symbols`) first** — the
> universe you render, and the `simulated` flag you must not swallow, are defined there.
>
> **State of the tree when you start:** tasks 01–03 are done. The contract types, the
> data seam, the store and the app shell all exist and their *Notes for other tasks*
> sections describe their final surfaces. Read those notes before this brief's
> *Inputs* section — where they disagree, the notes are newer.

---

## Where this fits in Phase 3

```text
   contracts (01) ──▶ data seam + store (02) ──┐
                                                │  useSyncExternalStore, per symbol
   app shell + theme (03) ──────────────────┐   │
                                            ▼   ▼
                              ┌──── you are here ─────┐
                              │  StockList  (route /) │
                              └───────────┬───────────┘
                                          │ click a row
                                          ▼
                               StockDetail (06) ──▶ PriceChart (05)
```

Others: **01** types · **02** the source, dispatcher and store · **03** the frame you
render inside · **05** the chart · **06** the detail page you navigate to · **07** the
connection status and stream badge in the header · **08** the gateway source, whose
conformance suite **re-runs your tests against a second data source** · **09** docs and
the recorded perf run.

That last point is the constraint that shapes your work: your tests must pass unchanged
against either source. Anything you assume about the simulator specifically will fail
task 08.

---

## Objective

Render the 34-instrument universe as a live table — price, change, change %, volume, last
update — searchable and sortable, where a tick for one symbol re-renders one row.

---

## Why this matters

This page is where the coalescing work either pays off or is thrown away. Task 02 reduced
3,750 ticks/sec to at most one store update per symbol per frame; a list component that
subscribes to "all prices" and re-renders the table on every update converts that back
into 60 full-table renders per second, each diffing 34 rows. The store exposes per-symbol
subscriptions precisely so a row can subscribe to its own symbol and nothing else.

The naive version — `const prices = useStore(); return rows.map(...)` — looks correct,
passes every functional test, and is the reason the page feels slow. There is a render-
counting test below because "feels fine on my machine with the default rate" is not
evidence.

---

## Specification

### Data flow

- On mount: `source.getUniverse()` for the instrument list (34 named symbols), then
  `source.subscribe(allSymbols)`.
- On unmount: `source.unsubscribe(allSymbols)`.
- Each row reads its own symbol through `useSyncExternalStore(subscribeSymbol(sym), () => getSymbolSnapshot(sym))`.
- The page itself does **not** subscribe to price data. It owns the symbol list, search
  text and sort state; nothing else.

### Columns

| Column | Source | Notes |
|---|---|---|
| Symbol | universe | monospace; the row's accessible name |
| Name | universe | truncates with ellipsis below 640px |
| Price | store | `format(price)`, decimal string in, string out |
| Change | store | signed, `format(change, { sign: true })` |
| Change % | store | `percentChange`, one decimal, signed |
| Volume | store | grouped thousands |
| Last update | store | relative ("2s ago"), recomputed on a 1s timer, not per tick |

Below 640px, Name and Volume drop out; Symbol, Price and Change % remain.

### Behaviour

- **Search** filters on symbol and name, case-insensitive, as you type. Debounce 150ms.
- **Sort** by any column, ascending/descending, indicated in the header cell. Default sort
  is by `weight` descending (the exchange's own activity order — COMI, CIB, ORAS, SWDY
  first), which is also the order that makes the skew visible.
- **Price flash** on change: brief background tint, up or down, **plus** the non-colour
  indicator task 03 defined. The flash must not schedule a re-render of its own — CSS
  animation keyed on the value, not a `setTimeout` in React state.
- **Row click** navigates to `/symbols/:symbol`. Rows are keyboard reachable and activate
  on Enter/Space.
- **Empty search result** renders an explicit "no instruments match" state, not a blank
  table.
- **Before the first tick** a symbol shows its `referencePrice` from the universe with a
  muted style, never a spinner per row and never `0.00`.

### `PriceCell.tsx`

The one component that renders a price. It takes `DecimalString`, formats via
`contracts/decimal.ts`, and applies the flash. Everything that shows a price — here and
in task 06 — goes through it, so there is exactly one place where a price could be
mis-rendered.

---

## Inputs you can rely on

From task 02 (confirm against its *Notes*):

```ts
export function createMarketDataSource(cfg?: Partial<ClientConfig>): MarketDataSource;
export function subscribeSymbol(symbol: string, cb: () => void): () => void;
export function getSymbolSnapshot(symbol: string): SymbolView | undefined;  // stable reference
export interface SymbolView { symbol: string; name: string; price: DecimalString;
  change: DecimalString; changePercent: number; volume: number; lastUpdate: number; stream: Stream }
export interface MarketDataSource {
  connect(): Promise<void>; disconnect(): void;
  subscribe(symbols: readonly string[]): void; unsubscribe(symbols: readonly string[]): void;
  getUniverse(): Promise<SymbolUniverseResponse>; getSnapshot(symbol: string): Promise<Snapshot>;
  readonly on: { tick(h): () => void; snapshot(h): () => void; status(h): () => void;
                 error(h): () => void; entitlement(h): () => void };
  readonly identity: () => Identity | null;
}
```

From task 01: `format`, `percentChange`, `compare`, `DecimalString`.
From task 03: the page container, theme tokens, and the non-colour up/down indicator.

---

## Constraints

- Prices are `DecimalString`; formatting happens in `PriceCell` only.
- No import of `SimulatedSource` or `TckrGatewaySource` — only `createMarketDataSource`.
- A tick for one symbol re-renders that row and nothing else.
- No unbounded state: you hold 34 rows, not a tick history.
- Usable at 400px, no horizontal scroll; rows keyboard-operable.

## Out of scope

The chart, the detail page, connection status, the stream badge, anything in `src/data/`
or `src/contracts/`. If a store field you need is missing, request it in *Notes* — do not
add it yourself.

---

## Tests

`src/pages/__tests__/`:

| Test | Asserts |
|---|---|
| `StockList.universe.test.tsx` | exactly 34 rows; the rendered symbol set equals the set in `public/symbols.json`; **no symbol appears that is not in that file** |
| `StockList.render-isolation.test.tsx` | with a render counter per row, a tick for COMI increments COMI's count by 1 and leaves all 33 others unchanged |
| `StockList.search.test.tsx` | typing `com` matches COMI by symbol and matches by name too; a non-matching query renders the empty state |
| `StockList.sort.test.tsx` | sorting by price ascending/descending orders via `compare`, not lexicographically (`9.90` sorts below `85.10`) |
| `StockList.default-order.test.tsx` | default order is `weight` descending — first four rows are COMI, CIB, ORAS, SWDY |
| `StockList.pre-tick.test.tsx` | before any tick, each row shows its `referencePrice` in the muted style, never `0.00` |
| `StockList.navigation.test.tsx` | clicking a row, and pressing Enter on a focused row, both navigate to `/symbols/<symbol>` |
| `StockList.lifecycle.test.tsx` | `subscribe` called once with all 34 on mount; `unsubscribe` called with the same set on unmount |

---

## Definition of done

- [ ] `npm run typecheck && npm test` exit 0; the eight test files above exist and pass.
- [ ] `StockList.universe.test.tsx` compares against `public/symbols.json` read from disk
      — not a hard-coded list in the test.
- [ ] `StockList.render-isolation.test.tsx` asserts **exactly** `1` extra render for the
      ticked row and `0` for the other 33; paste the counter output into *Notes*.
- [ ] `grep -rn "SimulatedSource\|TckrGatewaySource" src/pages/ src/components/PriceCell.tsx`
      returns nothing.
- [ ] `grep -rnE "parseFloat|Number\(" src/pages/StockList.tsx src/components/PriceCell.tsx`
      returns nothing.
- [ ] Every price rendered on the page passes through `PriceCell` — `grep -n "format(" src/pages/StockList.tsx`
      returns nothing (the page formats no price itself).
- [ ] At 400px the page shows Symbol, Price and Change % with no horizontal scrollbar;
      state how you checked in *Notes* (a Playwright screenshot from task 09 is the
      recorded evidence, a manual check is enough here).
- [ ] Rows are reachable by Tab and activate on Enter and Space
      (`StockList.navigation.test.tsx`).

## Verification

```bash
cd client/Tckr.MarketWatch
npm run typecheck && npm test -- StockList
npm run dev    # / at 400px and at desktop width; type in search; sort each column
grep -rn "SimulatedSource\|TckrGatewaySource" src/pages/
```

## Notes for other tasks

<!-- Fill in: the PriceCell surface task 06 reuses, the measured render-isolation
     counts, and any store field you needed that task 02 did not provide. -->
