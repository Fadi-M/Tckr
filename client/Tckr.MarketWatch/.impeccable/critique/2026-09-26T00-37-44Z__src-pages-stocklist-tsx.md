---
target: the market watch app (list + split detail)
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
target_identity: "file:/Users/fadi/Work/Tckr/client/Tckr.MarketWatch/src/pages/StockList.tsx"
target_fingerprint: "sha256:260c04b989da549854a1499221460571a740c3288c8d9a4be78af157a707ebf7"
target_path: /Users/fadi/Work/Tckr/client/Tckr.MarketWatch/src/pages/StockList.tsx
timestamp: 2026-09-26T00-37-44Z
slug: src-pages-stocklist-tsx
---
Method: dual-agent (A: design review · B: detector + browser evidence)

# Critique: Tckr Market Watch (src/pages/StockList.tsx plus the split detail pane)

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | Reconnect and stale states are excellent, but "Connected" glows green and rows say "just now" while EGX is closed. Neither stream (LIVE/DELAYED) is ever shown on the list. |
| 2 | Match System / Real World | 2 | Zero moves show coloured +0.0%/-0.0% chips. The Most Active badge reads "3,067,000 QTY". No EGX session-phase wording. |
| 3 | User Control and Freedom | 2 | At <=800px the filter row, including "All instruments", is hidden in split view (StockList.tsx:1137), leaving mobile detail with no back control. A third click on a sort header silently clears the sort. |
| 4 | Consistency and Standards | 2 | Numeric column headers are left-aligned over right-aligned figures (:1192). The table card stops 16px short of the search row. Stat-tile labels break the tracked-label pattern. |
| 5 | Error Prevention | 2 | Retry is safely guarded. The default 60S range on a quiet or closed market shows a flat "2 ticks" line that invites a misread. |
| 6 | Recognition Rather Than Recall | 2 | Sort state is only a tiny arrow. Preset pills don't light up when a manual sort matches them. Sparklines are flat on load. |
| 7 | Flexibility and Efficiency | 2 | Cmd-K search is good. No arrow-key row navigation, no range hotkeys. Rows are about 58px tall, so only about 8 fit above the fold. |
| 8 | Aesthetic and Minimalist Design | 3 | Calm, crafted glass with true dark parity. Hero cards and the Trend column add weight without information when closed. |
| 9 | Error Recovery | 3 | Close-code copy names the problem and the fix. The table dims when the stream drops. |
| 10 | Help and Documentation | 1 | Nothing explains DELAYED, what "Most active" ranks by, or the 30s display cadence. |
| Total | | 21/40 | Acceptable |

## Design Specificity Verdict
The type and signal system is specific: mono for machine figures, arrow glyphs on every coloured move, contrast-tuned chips, Cairo-time stamps. The composition is not: three glass hero cards over pills, search and a table is the default fintech dashboard. The server-sourced LIVE/DELAYED entitlement has no visual home. "LIVE" never appears in the UI, and DELAYED is only caption text on the detail view (StockDetail.tsx:627-636). EGX session phases and the pre-open auction are absent.

Deterministic scan: the static scan found 1 real issue, the layout-property transition at StockList.tsx:899 (max-height, margin-bottom). The browser scan added a width transition at :886 (missed by the static scan), a nested card (chart body inside the detail card), a thin border with a wide shadow on the detail card (a design call), a radial glow (a design-system choice), and the split-shell height (an accurate measurement). False positives: the layout transition reported on <body>, and cramped-padding on the table card. Contrast passes AA everywhere except the dark-mode hero down badge at 4.34:1.

## Overall Impression
Well crafted, and its failure states are better than most. But it communicates the wrong things at the wrong volume. The biggest opportunity: make LIVE/DELAYED plus market session the primary status.

## What's Working
1. Colour-plus-signal discipline: arrows and explicit signs everywhere, and the flash arrow never contradicts the day's direction.
2. How it fails: the reconnect and disconnect banners (StockList.tsx:351-401) say what happened, what it means and give one action. The table dims.
3. The split pane keeps context: search, sort and subscriptions survive, and the detail peak moment is strong.

## Priority Issues
- [P0] The entitlement has no persistent indicator. Fix: a header LIVE/DELAYED badge from identity().stream, a delayed marker on the list, and replace the "simulation artifact" caption. Command: /impeccable clarify
- [P1] Status signals contradict each other when the market is closed (green glowing Connected, "just now", ticks accumulating). Fix: merge transport and session into one cluster, show session phases, absolute Cairo time when closed, default the chart to SESSION. Command: /impeccable clarify
- [P1] Keyboard and screen-reader dead ends: collapsed hero cards stay focusable in split view (:898), focus doesn't move on open, no arrow-key rows, no chart summary. Command: /impeccable harden
- [P1] Mobile has no back control from detail below 800px (:1137), and the hero cards fill the 375px first screen. Command: /impeccable adapt
- [P2] The table lacks trading-board precision: left-aligned numeric headers, ~58px rows, coloured zero chips, flat sparklines, an undisclosed 30s repaint. Command: /impeccable layout, then /impeccable polish

## Persona Red Flags
Alex: 30s repaints, ~8 rows above the fold, no row or range hotkeys, the sort resets on a third click, an empty default 60S chart.
Sam: invisible focusable hero cards, no focus move on open, no chart summary, tiny Unicode glyph icons.
EGX delayed trader: no delayed signal on the list, a misleading "just now", the delayed note placed after the price, developer copy, no pre-open state.

## Minor Observations
- Dark hero down badge at 4.34:1.
- Layout transitions at :886/:899.
- The chart body is a nested card.
- "QTY" wording.
- Duplicate empty-state actions.
- Unstyled not-found state.
- Selection tint close to the up-chip tint.
- The same glyph for Market closed and Delayed.
- No chart time axis or reference line.

## Questions to Consider
- Would anyone miss the hero cards if a breadth strip replaced them?
- What if the entitlement organized the page?
- Is a 30s repaint compatible with "live"?
- Should "Connected" glow when there is nothing to stream?
