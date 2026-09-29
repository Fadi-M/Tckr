# Tckr.MarketWatch engineering guidelines

This is the single source of truth for how work in this package is done and judged. Every
task starts with `/preflight` against this file and ends with `/postflight` against its
[Definition of done](#definition-of-done). When a rule here and any other guidance disagree
(a skill, a habit, a generic best practice), this file wins, then the ADRs in
`docs/decisions/`, then `DESIGN.md` for visual matters.

Rules marked **[enforced: …]** are checked by a machine. The rest rely on review. When you
learn a new rule, add it here in the same change. When a rule can be machine-checked, add
the check and mark it.

## 1. Architecture

- **One seam.** Only `src/data/config.ts` names `SimulatedSource` or `TckrGatewaySource`.
  Everything else uses the `MarketDataSource` type and `getSharedSource()` /
  `createMarketDataSource()`. **[enforced: ESLint `no-restricted-imports`]**
- **Connection lifecycle belongs to `getSharedSource()`.** Never call `.connect()` on the
  returned source. A user-initiated retry goes through `reconnectSharedSource()`, which
  disconnects first so at most one socket is ever in flight.
- **`App.tsx` never imports `src/data/**`.** Resolved values come from `main.tsx`, the
  composition root. **[enforced: ESLint + `shell.no-data-import.test.ts`]**
- **Heavy libraries stay lazy.** `uplot` is imported only under `src/chart/`, and `StockDetail`
  is lazy-loaded from `App.tsx`. `gsap` is imported only by `src/motion/gsap.ts`, and is
  reached through `loadMotion()` / `useMotion()`. Don't use `@gsap/react`.
  **[enforced: ESLint + `bundle.footprint.test.ts` + `npm run check:bundle`]**
- **Both sources behave identically.** A data-layer change passes the conformance suite
  (`src/data/__tests__/conformance/`) against both implementations.
- **Test support stays local.** Put it in the module's own `__tests__/testSupport.ts`, not in a
  shared global fixture file.
- **Record why.** A decision that changes the wire contract, the seam, or a
  cross-cutting pattern gets an ADR in `docs/decisions/` before the code merges.
- **Design lens.** Prefer deep modules: a small interface over substantial behaviour.
  Information that more than one module needs has one owner (`software-design-philosophy`).

## 2. Correctness on the price path

- **No floats on a price.** No JS `number` or float parsing on any price that reaches a
  user or the wire. Use `DecimalString` and `src/contracts/decimal.ts`. Numbers are for
  plotting only (`toPlotValue`). **[enforced: `decimal.no-float.test.ts`]**
- **One formatter per quantity.** A percentage becomes text only through
  `src/display/percent.ts`. The same move must never read differently on two surfaces.
- **LIVE/DELAYED is a security property.** It comes only from the server's `identity()`,
  and is never computed, inferred or overridable on the client. DELAYED means 15 minutes
  behind; the simulator's 15-second offset is a local convenience, not the benchmark.
- **Display cadence.** Prices, board re-rank and hero picks share one beat,
  `DISPLAY_REFRESH_INTERVAL_MS` (10 s). Don't add a second clock.
- **Stale is visible.** When the stream drops, prices freeze visibly (the held state). They
  never keep animating as if live.

## 3. Code quality

- **Strict TypeScript.** Keep the `tsconfig.json` strictness settings. No `any`.
  **[enforced: `tsc` + ESLint type-checked rules]** A non-null `!` is only for a lookup
  whose presence an invariant guarantees (e.g. an index taken from the same array). Use
  `as unknown as` only at a platform boundary (the `WebSocket` factory, the simulated
  clock), with a comment.
- **Suppressions carry a reason.** Every `eslint-disable` states why on the same line or the
  line above. An unused directive is an error. **[enforced: ESLint]**
- **Comments explain why.** Doc comments give the reason and the constraint, not a
  restatement of the code. This repo's long "why" comments are intentional; keep them
  accurate when the code changes.
- **React Compiler lint rules are off, by decision.** `react-hooks/refs`, `purity` and
  `set-state-in-effect` are disabled in `eslint.config.js` because the app doesn't use the
  compiler and the hot price path reads refs and the clock during render on purpose
  (`PriceCell`, `RollingText`, the board re-rank). Adopting the compiler means turning them
  back on and reworking those paths together.
- **Size is a smell, not a rule.** A component over ~300 lines, or a hook-heavy
  function over ~150 lines, is a candidate for extraction through named, test-green
  steps (`refactoring-patterns`). Don't split code to hit a number.
- **No dead code.** No commented-out code, and no TODO without a tracked item in §Known debt.
- **Formatting.** Prettier (`.prettierrc.json`) owns code formatting; docs and `public/`
  data are excluded (`.prettierignore`). **[enforced: `npm run format:check`]** A future
  mass reformat is its own commit, listed in the repo-root `.git-blame-ignore-revs`.

## 4. Testing

- **Every behaviour change ships with a test** in the per-behaviour style (use the `gen-test`
  skill or the `test-writer` agent). Test files are named for the behaviour they cover, not
  the source file.
- **One home per behaviour.** Before adding a test file, look for the one that already
  covers the behaviour and extend it. Never assert the same thing in two files. A
  behaviour both sources must share is one `describe.each` in `conformance/`, not a copy
  per source.
- **Test what the product relies on.** Tests assert the market-data contract, prices,
  LIVE/DELAYED, EGX hours and connection states, and what must hold under a hot symbol's
  load (coalescing, one tick one row, bounded buffers, the entry bundle). They don't
  restate TypeScript's guarantees or pin class names. Page and component suites mock
  `src/data/config.ts` with its automatic mock (`vi.mock('…/data/config.ts')`, see
  `src/data/__mocks__/config.ts`) rather than writing their own.
- **Bugs get a regression test first.** Reproduce the bug in a test, then fix it.
- **Market-hours behaviour** (ticks, re-rank, opening bell, close) is checked in the running
  app with `npm run dev:open`, `npm run dev:bell` or `npm run dev -- --market HH:MM`.
- **Perf specs (`npm run test:perf`)** are run deliberately, not in CI. Re-run them and
  update `docs/phase-3-web-client/results.md` when a change touches `src/chart/**`,
  `TickDispatcher`, `store`, or the board's render path.

## 5. Performance

- **Frame budget.** The tick-to-paint path stays far below the 16.7 ms frame. Today the rAF
  callback p95 is 0.1 ms (see `results.md`). A regression of 2x or more needs a written
  justification.
- **One tick, one row.** A tick re-renders only its own row. Ticks are coalesced
  through `TickDispatcher`, never painted per event.
- **Entry bundle.** Under 125 KB gzip, with uplot and gsap absent.
  **[enforced: `npm run check:bundle` (built size) + `bundle.footprint.test.ts` (the
  entry's static import graph, on every `npm test`)]**
- **Motion runs on the compositor.** Animate only transform and opacity on anything
  that runs per tick.

## 6. Security

- **No raw HTML.** No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function`.
  Wire and REST data is rendered as text only.
- **Content-Security-Policy.** Production builds carry a CSP `<meta>` (`vite.config.ts`):
  inline scripts by hash only, no inline styles, `connect-src` limited to the gateway when
  the build uses it. A new external origin (font, CDN, API) is added there deliberately.
  **[enforced: `npm run check:bundle`]** `frame-ancestors` must be sent as a header when
  the app is hosted (Phase 11).
- **No secrets in the bundle.** `VITE_*` variables are public. Never put secrets in
  them. The future auth token never goes in a URL, a log line or `localStorage`.
- **Simulated data is refused in production.** Production refuses the simulated source
  unless the build explicitly opts in (`resolveClientConfig`). Don't weaken this guard.
- **Dependencies.** Versions are pinned exactly. `npm audit --omit=dev` must be clean at
  high severity. **[enforced: CI]** A new runtime dependency needs a stated reason and
  a bundle-size check.

## 7. Accessibility and UI/UX

- **DESIGN.md is the visual authority**, and `PRODUCT.md` is the product authority.
  `impeccable` is the primary UI tool: `shape` before a new surface, `critique` + `audit`
  before merging UI, `harden` before release.
- **Colour plus signal.** No price direction is shown by colour alone: ▲/▼ or an explicit
  sign always accompanies it.
- **Keyboard and focus.** Every interaction is keyboard-reachable, with a visible
  `focus-visible` ring. **[partly enforced: `eslint-plugin-jsx-a11y`]**
- **Page context.** Every view that shows one thing names it in the tab title with
  `useDocumentTitle` (`src/components/useDocumentTitle.ts`).
- **No streaming announcements.** Prices are never pushed to a live region, on the board
  or in the detail view. An opt-in "Announce price" toggle was built and removed by product
  decision (2026-09-28); revisit only with that decision.
- **Reduced motion.** Every moment honours `prefers-reduced-motion`. Colour and opacity
  fades may remain; movement may not.
- **Motion.** `emil-design-eng` is the rulebook, and `review-animations` reviews any
  diff that touches motion.
- **Conceptual model.** Connection and entitlement states (connecting, reconnecting, held,
  DELAYED, unknown symbol) must each be distinguishable and explained where they
  appear (`design-everyday-things`).

## 8. Engagement ethics

The price feed is already a variable reward, and the design must not amplify it.

- **Facilitator test.** Every engagement mechanic passes the Manipulation Matrix
  Facilitator test (`hooked-ux`).
- **Nothing rewards movement.** Nothing celebrates, rewards, or streaks price moves, gains
  or checking frequency.
- **Prompts fire on real events only:** market open or close, the auction, a user-set
  level, or an entitlement change.
- **No hidden cost or risk.** Fewer steps never means hiding cost or risk.

## 9. Documentation

- **Update docs in the same change.** When behaviour, configuration or a command changes,
  update `README.md` (the human guide), `CLAUDE.md` (agent orientation), and this file
  (rules) in that change.
- **Don't duplicate; link.** The contract lives in
  `docs/phase-3-web-client/client-contract.md`. Decisions live in ADRs.
- **Write for the reader's task:** second person, present tense, active voice
  (`technical-documentation` conventions).

## Skill precedence

These installed skills are lenses, not authorities. Where they conflict with this repo:

| Skill | Ignore here |
|---|---|
| `refactoring-patterns` | Class and inheritance recipes (Replace Type Code with Subclasses and similar). This is hooks and function code. |
| `software-design-philosophy` | Nothing, but prefer this repo's naming and comment style. |
| `hooked-ux` | Variable rewards on market data (§8). |
| `improve-retention` | Streaks, gamified progress, retention metrics that don't exist yet. |
| `design-everyday-things` | Nothing; apply within DESIGN.md's visual language. |

The global design-taste skills that conflict with DESIGN.md are turned off for this repo in
`.claude/settings.json` (`skillOverrides`).

## Definition of done

Mechanical checks. The Stop hook runs the first three on every turn that changed code, and
CI runs all of them:

- [ ] `npm run typecheck`, `npm run lint` and `npm test` pass.
- [ ] `npm run build` and `npm run check:bundle` pass.

Review. `/postflight` walks these:

- [ ] Behaviour change has a test. Bug fix has a regression test.
- [ ] `/code-review` findings are fixed or answered. Run `/simplify` on non-trivial diffs.
- [ ] `/security-review` if the change touches the data layer, config, env, or rendering of
  external data.
- [ ] UI change: `/impeccable critique` + `audit` are clean, and it was checked in the running
  app, in both themes and at 400 px.
- [ ] Motion change: `review-animations` is clean, and reduced motion was checked.
- [ ] Chart, dispatcher, store or board render change: `performance-analyzer` was run, and
  `results.md` updated if the numbers moved.
- [ ] Docs, ADRs and this file are updated. Any new debt is logged below.

## Known debt

Tracked items that the rules above would otherwise flag. Remove an entry when it's fixed.

1. **Two components are still large.** `StockList` (~580 lines: about half hooks and
   derived values, half the table and toolbar JSX; next step is `BoardToolbar`/`BoardTable`
   components) and `PriceChart` (~475 lines, mostly the landing tween and its comments,
   which share the `landing` state with the overlays). Both were split on 2026-09-28; see
   the module docs for where each piece now lives.
2. **The perf harness is stale** (found 2026-09-28, predates the Tailwind migration
   `66c2f3b`). `perf/frame-timing.spec.ts:164` and `perf/layout-400.spec.ts` wait for
   removed BEM classes (`.tckr-price-chart__canvas`, `.tckr-stocklist__table`), and a
   production build can't use `VITE_TCKR_SIM_CLOCK`, so outside EGX hours there are no
   ticks to measure. Fix: switch to stable hooks (`role="img"` / `data-testid`), add a
   Date-only clock shift in an init script (never `performance.now`/rAF), and write
   results to a scratch dir instead of the frozen `perf/raw/` baseline. Until then
   `npm run test:perf` cannot run, and render-path changes rely on code review.
