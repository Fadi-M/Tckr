# Task 03 — App Shell, Routing, Theme & Simulated Banner

| | |
|---|---|
| **Phase** | 3 — Market Watch Web Client |
| **Status** | Not started |
| **Depends on** | 01 |
| **Blocks** | 04, 05, 06 |
| **Parallel with** | 02 |
| **Owns** | `src/main.tsx`, `src/App.tsx`, `src/components/SimulatedBanner.tsx`, `src/styles/**` |

> **Read [`client-contract.md`](client-contract.md) §5 before styling anything** — the
> "what a Phase 3 implementation must not assume" section is the source of the banner
> requirement you own.
>
> **State of the tree when you start:** task 01 has produced the project, contract types
> and fixtures. Task 02 is being written in parallel and you **must not** import from
> `src/data/` — build the shell against routes and children only.

---

## Where this fits in Phase 3

```text
        contracts (01)
              │
   ┌──────────┴───────────┐
   ▼                      ▼
 data layer (02)   ┌─ you are here ─────────────────┐
                   │  main · App · routes · theme    │
                   │  SimulatedBanner (always on)    │
                   └──────────────┬─────────────────┘
                     ┌────────────┴────────────┐
                     ▼                         ▼
              StockList (04)            StockDetail (06)
                                          └─ PriceChart (05)
                        ConnectionStatus + StreamBadge (07) mount in your header
```

Others: **01** types · **02** the data seam and store · **04** list page · **05** chart ·
**06** detail page · **07** the connection status and stream badge that live in the header
slot you provide · **08** the gateway source · **09** docs and the recorded perf run.

You own the frame. Every other visible task renders inside it, so the layout contract you
set — header slots, page container, responsive behaviour, theme tokens — is what four
other agents build against.

---

## Objective

Provide the application frame: two routes, a header with slots for the connection status
and stream badge, a theme that works in light and dark, a layout that holds at 400px, and
a simulated-data marker that cannot be missed or dismissed.

---

## Why this matters

The banner is a **requirement, not decoration** (FR-7.4). The symbol universe is
fictional — `symbols.json` says so in its own `_disclaimer` — and a market-data screen
showing plausible EGX-flavoured tickers with moving prices and no disclosure is a
screenshot that can be mistaken for real market data. The one thing this client must
never do is let someone believe COMI traded at 85.42 today.

The layout matters for a duller reason: this is a price display, and people check prices
on a phone. A table that needs 900px is a table nobody uses. Getting the responsive rules
into the shell means four later tasks inherit them instead of each inventing their own
breakpoints.

---

## Specification

### Routes

`react-router-dom` v7, two routes only:

| Path | Renders |
|---|---|
| `/` | `<StockList />` (task 04) |
| `/symbols/:symbol` | `<StockDetail symbol={param} />` (task 06) |
| anything else | redirect to `/` |

Until tasks 04 and 06 land, route to a placeholder that renders the route name. Do not
stub their props differently from the signatures above.

### `App.tsx` layout

```text
┌─────────────────────────────────────────────────────────┐
│ ⚠ SIMULATED MARKET DATA — fictional instruments,        │  ← SimulatedBanner, always
│   not real EGX prices                                    │     first in the DOM
├─────────────────────────────────────────────────────────┤
│ Tckr · Market Watch          [status slot] [badge slot] │  ← header, children from 07
├─────────────────────────────────────────────────────────┤
│                                                         │
│   <Outlet />                                            │  ← page container
│                                                         │
└─────────────────────────────────────────────────────────┘
```

The header exposes two named slots as props (`statusSlot`, `badgeSlot`, both
`ReactNode`), so task 07 mounts into them without editing your file.

### `SimulatedBanner.tsx`

- Rendered by `App`, outside `<Outlet />`, so it is present on **every** route.
- Not dismissible. No close button, no `localStorage` "don't show again".
- Text names both facts: the data is simulated, and the instruments are fictional.
- When the source reports a simulated DELAYED offset, the banner also states it — e.g.
  *"DELAYED stream simulated with a 15s offset; the real delay is 15 minutes"*. Accept
  this as an optional prop (`delayedOffsetMs?: number`) rather than reading it from the
  data layer, which you do not import.
- `role="status"`, not `role="alert"` — it is permanent context, not an interruption.

### Theme

CSS custom properties in `src/styles/tokens.css`, defined on `:root` for light and
overridden under both `@media (prefers-color-scheme: dark)` and `[data-theme="dark"]`, so
an explicit toggle can win in either direction. Tokens at minimum: surface, surface-raised,
text, text-muted, border, accent, **up**, **down**, warning.

`up`/`down` must be distinguishable **without colour** wherever they are used — a price
change also carries an arrow or sign. Roughly 1 in 12 men has a red/green deficiency, and
this is a red/green display by convention.

### Responsive

One breakpoint at 640px. Below it: header collapses to two rows, page padding drops to
12px, and nothing may exceed the viewport width. Set `box-sizing: border-box` globally and
avoid any fixed `min-width` above 320px.

---

## Inputs you can rely on

From task 01: the project, `strict` TypeScript, Vitest + Testing Library configured, and
the viewport meta tag in `index.html`.

**Not** available to you: anything in `src/data/`. Task 02 owns it and is writing it in
parallel. If you believe the shell needs data, you need a prop instead — record the
request in *Notes for other tasks*.

Component signatures other tasks will provide, for your placeholders:

```tsx
export function StockList(): JSX.Element;                       // task 04, no props
export function StockDetail(props: { symbol: string }): JSX.Element;  // task 06
```

---

## Constraints

- No import from `src/data/**` anywhere in this task's files.
- The banner renders on every route and cannot be dismissed.
- Usable at 400px with no horizontal scrolling.
- Colour is never the only carrier of up/down meaning.
- No CSS framework dependency — tokens and plain CSS modules or a single stylesheet.

## Out of scope

The list, the detail page, the chart, the connection status and badge components
themselves (you provide the slots, task 07 fills them), and anything touching a data
source.

---

## Tests

`src/__tests__/`:

| Test | Asserts |
|---|---|
| `shell.banner-everywhere.test.tsx` | rendering at `/` and at `/symbols/COMI` both find the banner text; there is no button or control that removes it |
| `shell.banner-delay-label.test.tsx` | given `delayedOffsetMs={15000}`, the banner states the simulated offset and that the real delay is 15 minutes |
| `shell.routing.test.tsx` | `/` renders the list placeholder, `/symbols/COMI` renders the detail placeholder with `symbol="COMI"`, `/nonsense` redirects to `/` |
| `shell.slots.test.tsx` | nodes passed as `statusSlot` and `badgeSlot` appear in the header |
| `shell.no-data-import.test.ts` | the source of `App.tsx`, `main.tsx` and `SimulatedBanner.tsx` contains no `from '../data` / `from './data` import (read files, assert by regex) |
| `theme.tokens.test.ts` | `tokens.css` defines every required token under `:root`, under the dark media query, and under `[data-theme="dark"]` |

---

## Definition of done

- [ ] `npm run typecheck && npm test` exit 0; the six test files above exist and pass.
- [ ] `npm run build` exits 0 and `npm run dev` serves `/` and `/symbols/COMI` without a
      console error (paste the dev-server output into *Notes*).
- [ ] The banner is present in the rendered DOM of **both** routes — asserted by
      `shell.banner-everywhere.test.tsx`, not by inspection.
- [ ] `grep -rn "from '\.\./data\|from '\./data" src/App.tsx src/main.tsx src/components/SimulatedBanner.tsx`
      returns nothing.
- [ ] `tokens.css` defines all nine tokens in all three scopes; `grep -c '\-\-tckr-' src/styles/tokens.css`
      returns ≥27.
- [ ] No rule in any stylesheet sets a `min-width` greater than 320px —
      `grep -rn "min-width" src/styles/` reviewed and the result pasted into *Notes*.
- [ ] Up/down states carry a non-colour indicator; name the element in *Notes* so task 04
      uses the same one.
- [ ] The header exposes `statusSlot` and `badgeSlot` props, and task 07 needs to edit no
      file you own in order to use them.

## Verification

```bash
cd client/Tckr.MarketWatch
npm run typecheck && npm test && npm run build
npm run dev   # visit / and /symbols/COMI, resize to 400px wide, confirm no horizontal scrollbar
grep -rn "min-width" src/styles/
```

## Notes for other tasks

<!-- Fill in: the exact layout/slot props tasks 04, 06 and 07 render into, the token
     names, the non-colour up/down indicator, and any prop you need from the data layer. -->
