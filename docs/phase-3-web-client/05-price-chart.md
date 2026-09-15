# Task 05 — `PriceChart` — Price vs. Time on uPlot

| | |
|---|---|
| **Phase** | 3 — Market Watch Web Client |
| **Status** | Not started |
| **Depends on** | 02, 03 |
| **Blocks** | 06, 09 |
| **Parallel with** | 04, 06 |
| **Owns** | `src/chart/**` (`PriceChart.tsx`, `ringBuffer.ts`, `axes.ts`, `__tests__/`) |

> **Load the `dataviz` skill before writing chart code.** This brief specifies the
> mechanics — buffer, update path, formatting, performance — deliberately, not the visual
> design. Colour, axis treatment and legend are yours to design with that skill loaded,
> using task 03's theme tokens.
>
> **State of the tree when you start:** tasks 01–03 are done; read their *Notes for other
> tasks*. uPlot 1.6.x is already a dependency (task 01). Task 06 will mount your component
> — you build the chart, not the page around it.

---

## Where this fits in Phase 3

```text
   contracts (01) ──▶ data seam + store (02) ──▶ per-symbol updates
                                                        │
   app shell + tokens (03) ─────────────────┐           │
                                            ▼           ▼
                              ┌──────── you are here ────────┐
                              │  PriceChart — price vs time  │
                              └───────────────┬──────────────┘
                                              │ mounted by
                                     StockDetail (06)
```

Others: **01** types and decimal helpers · **02** the store your data comes from · **03**
theme tokens and the non-colour up/down convention · **04** the list that navigates here ·
**06** the page that mounts you and owns subscribe/unsubscribe · **07** connection status ·
**08** the gateway source (your component must not care which source is running) · **09**
the recorded Playwright frame-timing run that measures **your** render path.

---

## Objective

Plot one symbol's price against wall-clock time, updating as ticks arrive, with a bounded
buffer and exactly one uPlot data update per animation frame.

---

## Why this matters

This is the component task 09 measures. Everything upstream — coalescing, per-symbol
store subscriptions — exists so that this chart is asked to redraw at most 60 times a
second instead of 3,750. If the chart re-creates its uPlot instance on each update, or
allocates a new points array per tick, the whole chain is undone in the last component.

The second failure is quieter: an unbounded points array. A tab left open on a hot symbol
for an hour accumulates millions of points, and memory climbs until the tab dies. This is
the browser-side version of the unbounded queue the master context bans server-side, and
it is why the buffer is a fixed-size ring, not an array that grows.

---

## Specification

### `ringBuffer.ts`

```ts
export class RingBuffer {
  constructor(capacity: number);            // default caller passes 600
  push(timeMs: number, price: number): void;
  readonly times: Float64Array;             // uPlot-shaped, oldest → newest
  readonly values: Float64Array;
  readonly length: number;                  // ≤ capacity, always
}
```

Two pre-allocated `Float64Array`s written in place; `push` never allocates and never
grows. When full, the oldest point is overwritten.

**The one place a price becomes a number.** uPlot plots numbers; there is no way around
it. The rule is that the conversion happens *here*, at the plotting boundary, and the
converted value is used **only** for drawing. Every price the user reads — the axis
labels, the crosshair readout, the header — is formatted from the original
`DecimalString` (see `axes.ts`). A test asserts the component never renders a
`toFixed`-derived string.

### `axes.ts`

Tick formatting for both axes:

- **x** — wall-clock time, `HH:MM:SS`, adapting label density to width; the axis is real
  elapsed time, and gaps in the tape appear as gaps, not as evenly spaced points.
- **y** — price, formatted from the symbol's `tickSize` so the precision matches the
  instrument (an 18.42 stock shows 2 decimals, a 0.005-tick instrument shows 3).
  Formatting goes through `contracts/decimal.ts`, not `Number.toFixed`.

### `PriceChart.tsx`

```tsx
export interface PriceChartProps {
  readonly symbol: string;
  readonly tickSize: DecimalString;
  readonly capacity?: number;        // default 600
  readonly height?: number;          // default 320
}
export function PriceChart(props: PriceChartProps): JSX.Element;
```

Behaviour:

- Creates **one** uPlot instance on mount, destroys it on unmount. Never re-creates it on
  data change; never on a prop change other than `symbol`.
- Subscribes to its symbol through the store (`useSyncExternalStore`) and pushes each new
  value into the ring buffer, then calls `setData` **once per animation frame**, not once
  per store notification.
- Seeds itself from the snapshot already in the store, so the chart is not empty on
  arrival — a single point is enough.
- Resizes with its container (`ResizeObserver`) and renders correctly on a HiDPI display.
- Empty state before any data: an explicit "waiting for ticks" placeholder, not a blank
  canvas, and not a spinner that never resolves.
- A crosshair readout showing time and price at the cursor, price formatted from the
  decimal string.

---

## Inputs you can rely on

From task 02 (confirm against its *Notes*):

```ts
export function subscribeSymbol(symbol: string, cb: () => void): () => void;
export function getSymbolSnapshot(symbol: string): SymbolView | undefined;   // stable reference
export interface SymbolView { symbol: string; name: string; price: DecimalString;
  change: DecimalString; changePercent: number; volume: number; lastUpdate: number; stream: Stream }
```

From task 01: `DecimalString`, `format`, `toDecimal`.
From task 03: theme tokens (`--tckr-up`, `--tckr-down`, surface, border, text-muted) and
the non-colour up/down convention.

`SymbolView.lastUpdate` is your x value and `price` your y value. You do **not** receive a
tick stream directly — the store is already coalesced, and subscribing to the source
yourself would bypass that.

---

## Constraints

- One uPlot instance per mount; one `setData` per animation frame at most.
- The ring buffer is fixed-capacity and allocation-free on push.
- Numbers exist only inside the buffer and uPlot; every displayed price is formatted from
  `DecimalString`.
- No import from `src/data/` other than the store functions above; no source imports.
- Chart must work at 400px wide.

## Out of scope

Subscribing or unsubscribing the symbol (task 06 owns the lifecycle), the page header and
stats, candlesticks, indicators, zoom/pan history, multi-symbol overlays.

---

## Tests

`src/chart/__tests__/`:

| Test | Asserts |
|---|---|
| `ringBuffer.capacity.test.ts` | pushing 100,000 points into a capacity-600 buffer leaves `length === 600`, `times.length === 600`, and the newest value last |
| `ringBuffer.no-alloc.test.ts` | the `times`/`values` array references are identical before and after 10,000 pushes (proves no reallocation) |
| `ringBuffer.order.test.ts` | after wrap-around the series is monotonic in time, oldest → newest |
| `chart.one-setdata-per-frame.test.tsx` | 500 store notifications between two frames produce **exactly 1** `setData` call (uPlot mocked, frame scheduler injected) |
| `chart.single-instance.test.tsx` | the uPlot constructor is called once across 1,000 updates; called again only when `symbol` changes; `destroy` called on unmount |
| `chart.formatting.test.ts` | y-axis labels for `tickSize` `0.01` and `0.001` render 2 and 3 decimals respectively, and are produced from `DecimalString` — `toFixed` appears nowhere in the module |
| `chart.empty-state.test.tsx` | with no data, the placeholder renders; after one point it does not |
| `chart.seeded-from-store.test.tsx` | mounting with an existing store snapshot draws one point immediately |

---

## Definition of done

- [ ] `npm run typecheck && npm test` exit 0; the eight test files above exist and pass.
- [ ] `chart.one-setdata-per-frame.test.tsx` asserts **exactly 1** call, not "fewer than
      500"; paste the assertion output into *Notes*.
- [ ] `ringBuffer.capacity.test.ts` uses 100,000 pushes and asserts `length === 600`.
- [ ] `grep -rn "toFixed" src/chart/` returns nothing.
- [ ] `grep -rnE "parseFloat|Number\(" src/chart/` returns hits **only** inside
      `ringBuffer.ts` at the plotting boundary; list each one in *Notes* with a
      justification.
- [ ] `grep -rn "new uPlot" src/chart/` appears exactly once in the source.
- [ ] At a 400px viewport the chart renders with **≥3 y-axis labels, none clipped or
      overlapping**, and the x-axis showing at least two time labels. State the observed
      counts in *Notes*; task 09's Playwright run records the screenshot.
- [ ] The `dataviz` skill was loaded before the visual design was written — say so in
      *Notes*, with the design choices it drove.

## Verification

```bash
cd client/Tckr.MarketWatch
npm run typecheck && npm test -- chart
grep -rn "toFixed\|new uPlot" src/chart/
npm run dev   # /symbols/COMI — watch the line advance, resize the window, hover the crosshair
```

## Notes for other tasks

<!-- Fill in: the PriceChart props task 06 mounts, the measured setData-per-frame result,
     every Number() boundary and why, and what the dataviz skill changed about the design. -->
