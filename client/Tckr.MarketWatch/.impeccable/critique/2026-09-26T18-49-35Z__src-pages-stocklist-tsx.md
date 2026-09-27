---
target: the market watch app (list + split detail)
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/fadi/Work/Tckr/client/Tckr.MarketWatch/src/pages/StockList.tsx"
target_fingerprint: "sha256:fdc5e0f24eb45769d2b428a857e0744f70f55a203a7bbaffe78008fa058693c4"
target_path: /Users/fadi/Work/Tckr/client/Tckr.MarketWatch/src/pages/StockList.tsx
timestamp: 2026-09-26T18-49-35Z
slug: src-pages-stocklist-tsx
---
Method: dual-agent (A: design review · B: detector + browser evidence). Caveat: both agents shared one Playwright browser context, so A's tab showed B's detector overlays and was resized underneath it. A never saw B's findings text, and its conclusions were checked against source.

# Critique: Tckr Market Watch (src/pages/StockList.tsx plus the split detail pane)

EGX was closed during the review (Saturday), so everything observed is the closed-market state.

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Stream, connection and session are all honest now. On a closed market, "as of 14:30:00 Cairo" has no date (StockDetail.tsx:628). |
| 2 | Match System / Real World | 3 | EGX tick sizes, pre-open wording, "At close". "3,067,000 QTY" remains (StockList.tsx:740). The list shows +0.6% and the detail +0.59% for the same move. |
| 3 | User Control and Freedom | 2 | Nothing in src/ handles Escape, so there is no Escape-to-close on the detail. The third sort click still silently clears the sort (StockList.tsx:1326). |
| 4 | Consistency and Standards | 2 | Detail delta pills have no ▲/▼. Stat labels are mixed case, unlike the tracked headers. The native blue search-clear × is off-palette. |
| 5 | Error Prevention | 3 | Stale prices dim while reconnecting and Retry is guarded. The sort reset is the remaining trap. |
| 6 | Recognition Rather Than Recall | 2 | The shortcut hint appears only after a row has focus. DELAYED and "Most active" are explained only by a tooltip or not at all. |
| 7 | Flexibility and Efficiency | 3 | ↑↓/Home/End/Enter and ⌘K work. Reaching the rows takes 7 Tab stops. You can't step between symbols while the detail is open. |
| 8 | Aesthetic and Minimalist Design | 2 | At 390px the three hero cards fill the whole first screen. The chart has no axes and six equal tiles repeat High/Low. |
| 9 | Error Recovery | 3 | Close-code copy names the fix. The empty search offers "Did you mean ORAS". |
| 10 | Help and Documentation | 1 | Nothing explains the 15-minute entitlement, Lot/Tick, SESSION/60S, or the "Session" sparkline. |
| **Total** | | **24/40** | **Acceptable** (up from 21) |

## Design Specificity Verdict
LLM assessment: the header and the states are now truly Tckr: the server-sourced StreamBadge, a Connected pill that goes neutral when EGX is closed, the "Reopens Sun 10:00 Cairo" countdown, "At close", tick-size-aware decimals, and Lot/Tick tiles. The composition is still interchangeable: three glass hero cards over a table, then a stretched, axis-less chart over six equal tiles. The chart is the focal surface, and it reads as decoration, not a tape.

Deterministic scan: the CLI scan of src/pages, src/components, src/chart and index.html was clean (0 findings). The browser detector found:
- A real WCAG failure the review missed: the LIVE badge text is #0f7a4d on its tint at 4.2:1 (StreamBadge.tsx:61). The token that fixes it, --tckr-chip-text-up (text-chip-up), already exists and is used at StockList.tsx:752.
- nested-cards: the chart body inside the detail card (PriceChart.tsx:463).
- first-viewport-column-overflow: the list column is 164% of the viewport in split view (StockList.tsx:1099). The detail pane is not sticky.
- Design-system choices, not defects: radial-spotlight-glow (App.tsx:147-155) and thin-border-wide-shadow (StockDetail.tsx:596, StockList.tsx:708 and :1125).
- False positives: cramped-padding on the table wrapper (the table cells pad themselves), text-occlusion (the detector's own label), and dark-glow on body (the detector's amber overlay colour).

## Overall Impression
Real progress: 9 of the 13 prior issues are fixed, and the closed-market experience is honest and calming. The weak spot has moved from the list to the detail. The chart ignores the theme, has no axes, and turns a 2% day into a cliff. The biggest opportunity is a chart a trader can actually read.

## What's Working
1. An honest status system: StreamBadge, the idle Connected pill (ConnectionStatus.tsx:131), the Market closed banner with a countdown, and "At close".
2. Board mechanics a trader respects: tick-size decimals, a neutral 0.0% chip, arrow plus sign on Change, right-aligned numeric headers, 42px rows, FLIP re-rank, and a roving-tabindex table.
3. A useful empty search: "0 of 34", edit-distance "Did you mean", and a single "Show all 34".

## Priority Issues
1. [P1] The chart ignores theme changes. PriceChart.tsx:235-236 reads --tckr-color-accent and --tckr-color-border once, at mount. The key at StockDetail.tsx:672 is symbol:range, so it doesn't remount on a toggle. In dark mode the gridlines glare and the line stays light-theme green. Fix: key on the theme too, or restyle via a theme subscription. Command: /impeccable polish.
2. [P1] The chart can't be read. PriceChart.tsx:257-264 blanks both axes (values: () => []), and the auto-scale exaggerates quiet days. The closed-market as-of line has no date. Fix: sparse Cairo-time x ticks (open, midday, close), a right-edge last-price label, and a previous-close reference line. Add the date to as-of whenever the market isn't open. Command: /impeccable layout, then /impeccable clarify.
3. [P1] On the list, delayed rows look identical to live ones. The only list cue is a small header pill, and "At close"/"just now" never say "15 min behind". PRODUCT.md calls this distinction inviolable. Fix: give the board a delayed treatment (a caption on the table header, "as of HH:MM (−15m)" timestamps, a subtle amber rule), still sourced from identity(). Command: /impeccable clarify.
4. [P2] Keyboard and screen-reader gaps.
   - No Escape closes the detail.
   - 7 header Tab stops before the board, with no skip link.
   - Focus doesn't move into the detail when it opens.
   - Row aria-labels omit change and volume (StockList.tsx:983-989).
   - Two h1s (StockList.tsx:1471 and StockDetail.tsx:600).
   - The LIVE badge fails AA at 4.2:1 (StreamBadge.tsx:61).

   Command: /impeccable harden.
5. [P2] Generic hero cards cost the mobile first screen. At 390px the three cards stack (StockList.tsx:807) and the board starts around y=700. On a closed market they repeat rows. Fix: collapse them into one compact strip below 640px (or remove them), and show volume as "3.07M vol". Command: /impeccable distill, then /impeccable adapt.

## Persona Red Flags
- Alex (power user): can't step to the next or previous symbol with the detail open. No Escape and no "/" search alias. 7 Tabs to reach the board. The "Most active" ranking re-ranks with no cadence cue.
- Sam (keyboard / screen reader): nothing closes the detail on Escape, focus isn't moved into the detail, row labels lack change and volume, there are two h1s, and the LIVE badge fails contrast.
- EGX trader on the delayed entitlement: a list price is visually identical to a live one. The amber explainer lives only inside the detail. The phone hides the "15 min" offset at 640px and below. The risk is acting on a delayed price as if it were live.

## Minor Observations
- The third sort click clears the sort (StockList.tsx:1320-1328). Cycle asc/desc only.
- No ▲/▼ on the detail delta pills (StockDetail.tsx:622-627). Unify percentage precision between list and detail.
- Stat labels should be uppercase and tracked. High/Low appears both in the tiles and in the chart chips.
- Hide the native search cancel button and use an on-palette one.
- The chart body is a nested card inside the detail card. Flatten it.
- The detail pane isn't sticky while the 164%-tall list scrolls beside it.
- The Market closed banner spans full width in split view.
- The search focus ring reads as a heavy glow in dark mode.

## Questions to Consider
- If LIVE/DELAYED is a security property, why does a delayed list price look pixel-identical to a live one?
- Would the board be stronger with no hero cards, letting the "Gainers" and "Most active" presets be the hero?
- On a closed market, should the chart replay Thursday, or frame the session explicitly ("ended 14:30, next open Sun 10:00") with the previous close marked?
