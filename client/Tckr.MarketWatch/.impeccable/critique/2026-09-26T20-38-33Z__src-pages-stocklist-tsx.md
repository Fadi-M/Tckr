---
target: the market watch app (list + split detail)
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/fadi/Work/Tckr/client/Tckr.MarketWatch/src/pages/StockList.tsx"
target_fingerprint: "sha256:be6db7139fe55cd3dfd01760e4c208fd4aa234970e68a4172031ecb51917dc38"
target_path: /Users/fadi/Work/Tckr/client/Tckr.MarketWatch/src/pages/StockList.tsx
timestamp: 2026-09-26T20-38-33Z
slug: src-pages-stocklist-tsx
---
Method: dual-agent (A: design review, own isolated Chromium · B: detector + browser evidence, shared MCP browser)

# Critique: Tckr Market Watch (src/pages/StockList.tsx plus the split detail pane)

EGX was closed during the review (Saturday), so everything observed is the closed-market state. LIVE (:5173) and DELAYED (:5174) users were both inspected.

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Stream, connection, session and the dated as-of line are honest. On a closed day, "Last update" repeats "At close" 34 times (StockList.tsx:1018). |
| 2 | Match System / Real World | 3 | "Most active" ranks by share count, not traded value (StockList.tsx:183), so penny stocks lead. "Session · 541 ticks" is plumbing vocabulary (PriceChart.tsx:699). |
| 3 | User Control and Freedom | 3 | Escape closes and restores focus, arrows follow, and sorting toggles. The pane has no close control of its own. |
| 4 | Consistency and Standards | 3 | Three different delta-chip treatments: the board chip, the hero badge and the detail pill. |
| 5 | Error Prevention | 3 | On DELAYED, the hero cards sit outside the delayed frame. 60S/5M stay offered on a closed market. |
| 6 | Recognition Rather Than Recall | 3 | The shortcut legend renders below row 34, off-screen, and omits Esc (StockList.tsx:1826). |
| 7 | Flexibility and Efficiency | 3 | ⌘K, arrow-follow, Home/End and Esc all work. The skip link is the 3rd Tab stop. ⌘ is shown to Windows users too. |
| 8 | Aesthetic and Minimalist Design | 3 | The chart reads well, but the red area fill turns a −0.16% day into a wall of red (PriceChart.tsx:408). Hero cards fill the phone's first screen. |
| 9 | Error Recovery | 3 | The empty search offers "0 of 34", "Did you mean" and "Show all 34". Reconnect copy is clear. |
| 10 | Help and Documentation | 2 | Nothing explains the Session sparkline, what a "tick" is, or why 60S is flat after the close. |
| **Total** | | **29/40** | **Good** (up from 24) |

## Design Specificity Verdict
LLM assessment: the pane and the states now clearly belong to Tckr:
- Cairo-dated as-of line
- dashed session-Open line
- direction-coloured last-price tag
- tick-size decimals
- Lot/Tick tiles
- reopen countdown
- amber delayed note on the board

The composition above the board is still interchangeable: three "Top gainer / Top loser / Most active" glass cards over a table. "Most active" by share count isn't how EGX reports it; EGX also ranks by traded value.

Deterministic scan: the CLI found 0 findings in src/pages, src/components, src/chart, App.tsx and index.html. Across 7 views the browser detector reported:
- radial-spotlight-glow: the ambient blobs, App.tsx:~150-165. A real match, but on purpose.
- gpt-thin-border-wide-shadow: the detail card, StockDetail.tsx:616. Low severity.
- cramped-padding: the full-width table wrapper, StockList.tsx:1212. A false positive (the cells pad themselves).
- first-viewport-column-overflow: the split shell, StockList.tsx:1180. A false positive (an intentional sticky master/detail).

Mobile list: 0 findings. Nothing was self-detected. nested-cards no longer fires, so the chart-card flattening held. The design reviewer's note that the chart body is "still a nested card" is contradicted by both the source and the detector, and was dropped.

## Overall Impression
A big step. Every prior P1 is fixed. The chart is now a real trading tool, and the keyboard model is excellent. What remains is the frame around the board: the hero cards escape the delayed frame and say "most active" in the wrong currency, and the chart's fill shouts direction louder than the move warrants.

## What's Working
1. An honest state system: the server-sourced LIVE/DELAYED badge (AA-safe), the delayed board note, ", delayed stream" in row labels, the Cairo-dated as-of line and the reopen countdown.
2. A chart a trader can read: Cairo HH:MM axis, tick-precision y axis, Open line, last-price tag, direction colour, and live restyling on theme change.
3. The master-detail keyboard model: roving tabindex, the pane following the arrows, Escape restoring focus, focus moving to the h2 on mobile, and a single h1.

## Priority Issues
1. [P1] Hero cards leak outside the delayed frame. On DELAYED, the ORWE/ARCC/EKHO prices render above the amber board note (StockList.tsx:1650 vs :1721), with no clock and no "delayed" in their aria-label (StockList.tsx:~820). They are the most prominent prices on the page. Fix: put the note (or one delayed frame) above the hero row, add ", delayed stream" to the hero aria-label, and add an amber clock to the kicker. Command: /impeccable clarify (or harden).
2. [P1] The chart fill exaggerates direction. The area fill runs to the y-minimum in the closing-direction colour (PriceChart.tsx:~408), so a session spent near the open reads as a red wall at −0.16%. Fix: fill between the line and the Open reference (uPlot `bands`: green above, red below), or a low-alpha gradient that fades out. Also stop the "Open 85.10" caption from sitting on the line. Command: /impeccable colorize (or polish).
3. [P2] Closed-market ranges mislead. 60S/5M cut off from `Date.now()` (StockDetail.tsx:~596) and render "Last 60s · 2 ticks" across a 1-second axis. Fix: when closed, disable them or anchor them to the session close ("Last 60s of session"). Command: /impeccable clarify.
4. [P2] "Most active" by share count doesn't fit EGX. It favours sub-EGP-5 names (StockList.tsx:183). Fix: rank by traded value (price × volume, display-only), show "EGP 25.2M", and label the Volume column "(shares)". Command: /impeccable clarify.
5. [P3] Keyboard discoverability. The legend sits below row 34 and omits Esc. The skip link is not the first Tab stop (move it into App.tsx before the logo). Show Ctrl on non-Mac (StockList.tsx:~1711). Command: /impeccable harden.

## Persona Red Flags
- Alex (power user): no "/" alias for search. No next/prev control in the mobile detail. The presets, hero cards and header sorts are three routes to the same ordering. 34 identical "At close" cells on a closed day. "Most active" ranks penny stocks first.
- Sam (keyboard / screen reader): the skip link is the 3rd stop. The legend is aria-hidden and off-screen, so Esc and arrow-follow are never announced. The pane has no close button of its own.
- EGX trader on the delayed entitlement: the first three prices on a phone (the hero cards) are the unmarked ones. The detail then over-explains, saying "delayed" four times (badge, board note, as-of suffix, callout). Collapse the as-of suffix and the callout into one line.

## Minor Observations
- On mobile, the detail's % pill wraps onto its own line (StockDetail.tsx:640).
- The mobile chart shows only two x labels. Add the 10:00 and 14:30 endpoints.
- The dark-mode search focus ring still reads heavy.
- The default board order is unsorted, with nothing active that says what order you are looking at.
- The Connected pill steps down to neutral when closed, but its dot stays green (ConnectionStatus.tsx:197).
- The detail % pill carries a sign but no glyph, while its neighbour has ▲/▼. This is intentional, but inconsistent to the eye.
- Six equal stat tiles mix session facts with static reference data (Lot/Tick). Two groups would read better.

## Questions to Consider
- If the hero cards stay, should they show what the board can't (breadth "22 up / 12 down", session traded value) instead of repeating the Gainers/Losers presets?
- Should direction colour describe the path relative to the open (band fill) instead of painting the whole session in its closing colour?
- On a closed market, is the detail a live chart or a session recap? If it's a recap, say so ("Thu 24 Sep session, closed 14:30") and hide the live-only ranges.
