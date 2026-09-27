---
target: src/pages/StockList.tsx (list + split detail)
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:/Users/fadi/Work/Tckr/client/Tckr.MarketWatch/src/pages/StockList.tsx"
target_fingerprint: "sha256:f2a5aa0c60691013fa2f26e7885876b5281623a1f1d8e411802e8d12dc5e9ffe"
target_path: /Users/fadi/Work/Tckr/client/Tckr.MarketWatch/src/pages/StockList.tsx
timestamp: 2026-09-27T00-27-41Z
slug: src-pages-stocklist-tsx
---
Method: dual-agent (A: design review · B: detector + browser evidence). Both used headless Chromium because the Playwright MCP browser profile was locked.

# Critique: Tckr Market Watch (src/pages/StockList.tsx and the split detail pane)

Reviewed on Sunday 2026-09-27 at about 03:25 Cairo, so EGX was closed. Checked at 1440×900 and 390×844, in light and dark.

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | The banners are honest. Rows and the detail repaint at most every 30s (display/throttle.ts:26), but the green LIVE badge doesn't say so. |
| 2 | Match System / Real World | 3 | The price column mixes decimal places (246.3 / 85.60 / 6.129), so the decimal points don't line up. A numeric header sorts lowest-first on the first click. |
| 3 | User Control and Freedom | 3 | Esc, ×, and "Show all" work. Once you sort, there's no way back to Exchange order (StockList.tsx:1499-1507). |
| 4 | Consistency and Standards | 3 | The LIVE badge stays green while the market is closed, but the connection pill turns neutral. The range pills' aria-labels don't contain their visible text. |
| 5 | Error Prevention | 3 | A stale board dims and says it's frozen. Little else can go wrong. |
| 6 | Recognition Rather Than Recall | 3 | The caption says the current sort order. Presets and header sorts are two overlapping ways to reorder the board. |
| 7 | Flexibility and Efficiency | 3 | Roving tabindex, ⌘K and /, and arrow keys that move the open detail. There's no way to pin a symbol. |
| 8 | Aesthetic and Minimalist Design | 3 | The per-second "Connected · 2s" timer is noise. On a phone the hero cards push the board below the fold. |
| 9 | Error Recovery | 3 | Each close code gets its own message, plus Retry and a "Reconnected" confirmation. |
| 10 | Help and Documentation | 2 | Value vs Volume, Session trend and the preset hints are explained only in `title` tooltips, which touch users can't open. |
| **Total** | | **29/40** | **Good** |

## Design Specificity Verdict
The review judges it authored, not interchangeable. Examples: the EGX calendar and Cairo time, Most active ranked by EGP value, lot and tick size, chart labels that know the session is closed, LIVE/DELAYED labels everywhere they matter, and FLIP re-ranking. The generic part is the visual layer. The frosted glass with mint and coral glows would fit any fintech dashboard. The product's character comes from the copy and the states, not the look.
Detector: the CLI scan found nothing in StockList.tsx, StockDetail.tsx or src/components. The browser overlay found 4 unique issues, all false positives: radial-spotlight-glow (the documented Frost glows), thin-border-wide-shadow (shadow-float has a -16px spread, and the SkipLink is only visible on focus, though its shadow is a one-off token), cramped-padding (the table is meant to run edge to edge inside its card), and first-viewport-column-overflow (the detail pane is sticky at StockList.tsx:1211).

## Priority Issues
1. [P0] The LIVE board repaints at most every 30s (display/throttle.ts:26). This covers rows, hero cards and the detail price. The simulated DELAYED stream is 15s behind, so a LIVE user can see older prices than a DELAYED user. That blurs the live/delayed line the product says must never blur, and the module's own comment cites a guideline of 1–4 updates per second. Fix: repaint every 250–1000ms, and keep the 30s cadence only for re-ranking and the hero cards. /impeccable optimize
2. [P1] The live regions keep talking to screen readers. The connection pill is role=status and its text changes every second (ConnectionStatus.tsx:175-211). The closed-market countdown is role=status and changes every minute (StockList.tsx:692-700). Fix: remove the elapsed timer from the live region and announce only state changes. /impeccable harden
3. [P1] Rows don't announce that they can be activated. They're `<tr tabIndex>` with no actionable role (StockList.tsx:1099-1118). Separately, the range pills' aria-labels don't contain "60S" or "SESSION" (StockDetail.tsx:662-663). Fix: put a button or link in the Symbol cell, and name the pills "60S: last 60 seconds". /impeccable audit
4. [P2] Scanning and sorting. Decimal places are mixed in one column. The first click on a numeric header sorts lowest-first. There's no way back to Exchange order. A filtered search shows no count and announces nothing. /impeccable layout, /impeccable clarify
5. [P2] On a phone the three stacked hero cards (about 430px tall) push the board below the fold, and only 2 rows are visible. Fix: below 640px, make them a horizontal strip or compact chips. /impeccable adapt

## Persona Red Flags
- Alex (power user): the 30s repaint makes the board useless for tape-reading. There's no pin, the 30s re-rank moves the symbol being watched, there are 12 overlapping sort and filter controls, and no way back to Exchange order.
- Sam (keyboard and screen reader): chatty live regions, rows with no role, pills that fail label-in-name, tooltips that can't be reached, and search results that are never announced. The theme toggle is 30×30. The skip link and focus return were verified to work.
- EGX trader at the 10:00 bell: COMI ticks, but the row and detail price stay frozen for up to 30s under a green LIVE badge.

## Minor Observations
- On a closed market the LIVE badge keeps its green dot. The connection pill turns neutral in the same state.
- The hero cards don't say they show Thursday's session.
- Typing "COMY" suggests ARCC, matched through the word "Company" in its name.
- On mobile the detail's × wraps down beside the range pills.
- The sparklines are high-frequency squiggles. Downsample them to about 20 points.
- In the split view, the closed-market banner wraps to 3 lines in the 380px list column.
- The SkipLink shadow isn't in the Shadow Vocabulary.
- Dark mode is well tuned.

## Questions to Consider
- If LIVE repaints every 30s and DELAYED is 15s behind, what does "LIVE" promise? Should the screen show freshness, e.g. "updated 3s ago"?
- Do the hero cards earn their space on a trading board, or are they a landing-page device?
- Presets and header sorts do the same job. Which one would an EGX trader miss?
