/**
 * Display-refresh throttling — "Tckr First Run" design pass follow-up.
 *
 * The underlying feed can push thousands of ticks/sec for a hot symbol (FR-1: ~25,000
 * events/sec across the whole exchange tape, unevenly weighted toward a handful of
 * symbols). `TickDispatcher` (`src/data/TickDispatcher.ts`) already coalesces that down
 * to at most one *store write* per symbol per animation frame — a data-correctness/
 * perf contract, not a readability one. Even at 60fps, a number that changes 60 times a
 * second reads as noise, not information: human perception of *discrete, symbolic*
 * changes (as opposed to smooth motion) saturates well below the ~60Hz frame rate —
 * commonly cited UX guidance for live-updating text/numeric displays caps meaningful
 * refresh at roughly 1-4 updates/sec (e.g. most retail market-data UIs — Google
 * Finance, brokerage watchlists — visibly refresh on the order of once a second even
 * when their backend feed is much faster; beyond ~4-5 Hz, sequential value changes stop
 * being individually readable and blur into flicker). Tckr paces a calm board below even
 * that low end (product decision, 2026-09-27): one beat, `DISPLAY_REFRESH_INTERVAL_MS`
 * (10s), for everything that moves — every row, the hero cards' figures and picks, the
 * board's order when sorted, the detail header and the chart's live sample. Fast enough
 * that a LIVE board reads as live (the DELAYED entitlement is 15 *minutes* behind), slow
 * enough that each change can be caught landing. Order and picks move on the same beat
 * as the prices (it used to be 20s) because anything slower lets them contradict the
 * figures they were chosen by: a "Top gainer" showing a falling price, a falling row on
 * top of "Gainers".
 *
 * The beat is aligned to the wall clock (`k·interval` in `Date.now()` time) and driven
 * by `pacedViews.ts`, so every view of a symbol changes in the same commit.
 *
 * This is a presentation-layer concern only, layered *on top of* the data layer's own
 * coalescing, not a replacement for it: the store and `StockDetail` still merge every
 * tick with "newer wins" semantics — only how often that result is *painted* is capped.
 */

/** Price repaint cadence: 1 update/10s — see module doc for why. */
export const DISPLAY_REFRESH_INTERVAL_MS = 10_000;
