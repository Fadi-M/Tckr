---
target: src/pages/StockList.tsx (list + split detail)
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/fadi/Work/Tckr/client/Tckr.MarketWatch/src/pages/StockList.tsx"
target_fingerprint: "sha256:72ae3ad4f622e536cd36f56baee361c95ff1c2c2c48dec4b9a3447e610f69ce4"
target_path: /Users/fadi/Work/Tckr/client/Tckr.MarketWatch/src/pages/StockList.tsx
timestamp: 2026-09-27T00-51-54Z
slug: src-pages-stocklist-tsx
closed: true
---
Method: dual-agent (A: design review · B: detector + browser evidence). Both used headless Chromium because the Playwright MCP browser profile was locked.

# Critique: Tckr Market Watch (src/pages/StockList.tsx + split detail pane)

Reviewed Sunday 2026-09-27 ~03:46 Cairo (EGX closed). Checked at 1440×900 and 390×844, light and dark, LIVE and DELAYED users.

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | LIVE repaints every 30s (throttle.ts:26). The detail pane has no stale treatment. |
| 2 | Match System / Real World | 3 | "Reopens Sun 10:00" on Sunday itself (StockList.tsx:728/737). |
| 3 | User Control and Freedom | 3 | Clicking the already-open row closes the pane (StockList.tsx:1600). |
| 4 | Consistency and Standards | 3 | Range and order pills are styled differently. DESIGN.md contradicts itself on the chart line colour. |
| 5 | Error Prevention | 3 | Frozen prices are only dimmed to 72% and stay clickable. |
| 6 | Recognition Rather Than Recall | 3 | The chart crosshair shows no value. |
| 7 | Flexibility and Efficiency | 3 | Can't step between symbols in the mobile detail view. |
| 8 | Aesthetic and Minimalist Design | 3 | The list toolbar spans the chart in split view. DELAYED mobile stacks two banners. |
| 9 | Error Recovery | 3 | "Did you mean" suggestions and actionable close-code messages. |
| 10 | Help and Documentation | 2 | Help exists only in title= tooltips, which touch users can't open. |
| **Total** | | **29/40** | **Good** |

## Design Specificity Verdict
Behaviour and copy are authored for Tckr and EGX. The visual composition is generic: the hero trio, sparklines in every row, and frosted pills. Entitlement and hold state appear only as banners and don't shape the layout.
Detector: the CLI found 0 issues. The browser scan flagged 5 elements across 4 rules, all false positives: the documented glow, shadow-float twice, the edge-to-edge table card, and the sticky split pane. No user-visible overlay (headless run).

## Priority Issues
1. [P1] LIVE repaints every 30s (throttle.ts:26). This covers rows, heroes, the detail price and chart sampling. It is deliberate, but the module doc cites 1–4 Hz as readable. A LIVE user can see older prices than the 15s DELAYED sim, the 60S/5M ranges are hollow, and the selected row (unthrottled, :1080) can disagree with the detail header. Fix: repaint every 500–1000ms, keep a slow cadence for re-rank and hero picks and label it, and append every coalesced tick to the chart. /impeccable optimize, /impeccable animate
2. [P1] The stale state is weak: opacity-0.72 on the table (StockList.tsx:1316), no stale state in StockDetail, and the banner isn't sticky. Fix: keep full contrast, add a HELD tag or amber edge, show "held since" on the as-of line, and make the banner sticky or mirror it in the pane. /impeccable harden
3. [P1] The chart crosshair has no value readout. legend is off (PriceChart.tsx:489), and the comments describe a readout that doesn't exist. Fix: a chip following the cursor showing time · price, with ←/→ on focus. /impeccable clarify
4. [P2] In split view the list toolbar (about 11 controls) spans the chart (StockList.tsx:1789-1845). Fix: move search and ordering into the list column. /impeccable layout
5. [P2] Board rows are <tr tabIndex> with no role (StockList.tsx:1159-1178). Fix: role=grid, or make the Symbol link the roving Tab target. /impeccable audit

## Persona Red Flags
- Alex: 30s repaint, no crosshair value, useless 60S range, 12 overlapping ordering controls, clicking the open row closes it.
- Sam: rows with no role, status wrappers still mutating every second, a chart that can't be explored, 13+ Tabs without the skip link. Skip link, Esc focus return and aria-describedby verified working.
- EGX trader: "Reopens Sun" on Sunday, no previous-close reference, spike-mass mobile chart, two DELAYED banners on a phone, no Arabic names.

## Minor Observations
- The empty state echoes rawQuery while the count uses debouncedQuery (StockList.tsx:1909).
- The light-mode Open axis tag has no fill.
- The range chip can collide with an early high.
- The sparkline doc says 34px but the class is h-6.
- A closed market drops the per-row amber clock for DELAYED users.
- A red −0.02% chip on a 0.01 move is loud.

## Questions to Consider
- What is a LIVE subscriber paying for if LIVE repaints every 30s?
- Do the hero cards earn their space on an Operate surface?
- Should the board itself show per-row freshness or hold state, rather than leaving it to banners?
