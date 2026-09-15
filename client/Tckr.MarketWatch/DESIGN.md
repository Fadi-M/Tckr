---
name: Tckr Market Watch
description: A dark-default, terminal-flavored market-data client — mint/coral signal colors, monospace numerics, and a live ticker tape, built around a strict live/delayed data contract.
colors:
  terminal-mint: "#3fd79c"
  alert-coral: "#f2705f"
  amber-caution: "#d9a441"
  surface: "#0c0d0e"
  surface-raised: "#17181a"
  text: "#f2f1ee"
  text-muted: "#9296a0"
  border: "rgba(255, 255, 255, 0.1)"
typography:
  display:
    fontFamily: "'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "2.4rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "1.4rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Archivo, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.65rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.1em"
rounded:
  "2": "2px"
  "3": "3px"
  "4": "4px"
  "5": "5px"
  "6": "6px"
  "7": "7px"
  "8": "8px"
  "9": "9px"
  "10": "10px"
  pill: "999px"
components:
  button-primary:
    backgroundColor: "{colors.text}"
    textColor: "{colors.surface}"
    rounded: "{rounded.6}"
    padding: "7px 13px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.pill}"
    padding: "7px 12px"
  badge-live:
    backgroundColor: "color-mix(in oklab, {colors.terminal-mint} 14%, transparent)"
    textColor: "{colors.terminal-mint}"
    rounded: "{rounded.5}"
    padding: "5px 9px"
  badge-delayed:
    backgroundColor: "color-mix(in oklab, {colors.amber-caution} 13%, transparent)"
    textColor: "{colors.amber-caution}"
    rounded: "{rounded.5}"
    padding: "5px 9px"
---

# Design System: Tckr Market Watch

## Overview

**Creative North Star: "The Night Terminal"**

Tckr Market Watch reads like a professional trading terminal built for a dim room, not a
consumer finance app. The page opens dark by construction — `data-theme="dark"` is
hard-coded on `<html>`, so this is the software's resting state, not a toggle a user
finds later. Every surface is near-black and bordered rather than shadowed; every number
is set in a monospace face with tabular figures so a column of prices lines up like a
ledger; a scrolling ticker tape and per-row sparklines give the page a pulse without ever
becoming its subject. The two signal colors that matter — Terminal Mint for "up" and
"live," Alert Coral for "down" — never appear as decoration; they only ever mark a real
state change, and they never appear alone: a `▲`/`▼` glyph rides with every colored delta
so the meaning survives for a colorblind viewer. Nothing in this system uses a shadow,
a gradient (beyond the tape's edge-fade mask), or a solid saturated fill outside of a
badge/pill — depth comes from tone (`surface` vs. `surface-raised`) and hairline borders,
never elevation. The system is quietly technical and unhurried: motion exists (the tape's
32-second loop, a 900ms price-flash pulse) but is calm and rhythmic, never urgent or
flashy — it earns trust by looking like an instrument, not a toy.

**Key Characteristics:**
- Dark-by-default, not dark-as-option — the light theme is a plain daytime fallback for an
  explicit override, not the primary experience.
- Every number is monospace with tabular figures; every UI label/heading is Archivo.
  The two faces never swap roles.
- Color never carries meaning alone — every up/down signal pairs a color with a `▲`/`▼`
  glyph.
- Flat by construction: zero `box-shadow` anywhere in the codebase. Depth is tonal
  layering plus 1px hairline borders.
- Status surfaces (LIVE, DELAYED, warnings, errors) are always a translucent tint over
  the base surface (`color-mix`, 9–14% strength), never a solid fill.

## Colors

A near-monochrome dark base (true neutrals, no tint) carries two small, disciplined
accent families — mint for positive/live, coral for negative, amber for caution/delay —
each used sparingly and only to mean something specific.

### Primary
- **Terminal Mint** (`#3fd79c` dark · `#1a8f5c` light): the system's one "good" signal —
  price-up deltas, the LIVE badge and its status dot, the connected-state dot, the header
  brand mark, and the price-chart line/cursor. Also `--tckr-color-accent`, so it doubles
  as the only interactive-focus accent (`outline` on focus-visible).

### Secondary
- **Alert Coral** (`#f2705f` dark · `#c73e2c` light): price-down deltas, the
  disconnected/error status dot and banner, and the slow-consumer close message. The
  system's only "something is wrong or falling" signal.

### Tertiary
- **Amber Caution** (`#d9a441` dark · `#8a5a00` light): the DELAYED badge, the permanent
  simulated-data banner, the reconnecting-warning banner, the "◆ SIMULATED TAPE"
  header tag, and the "TAPE HELD" overlay label. Reserved for "this is not the live,
  trusted state" — never used for a positive signal.

### Neutral
- **Surface** (`#0c0d0e` dark · `#ffffff` light): the base page/card background.
- **Surface Raised** (`#17181a` dark · `#f4f5f7` light): one tone up — table headers,
  the search box, chart body, stat cells, hover state on table rows.
- **Text** (`#f2f1ee` dark · `#14181f` light): primary reading color; also the fill for
  every "primary/active" pill and button (inverted against Surface).
- **Text Muted** (`#9296a0` dark · `#5b6472` light): secondary text, placeholders,
  inactive pill/tab labels, timestamps.
- **Border** (`rgba(255,255,255,0.1)` dark · `#d8dbe1` light): the only depth cue in the
  system — every card, table, input, and divider is separated by this 1px hairline,
  never a shadow.

### Named Rules
**The Color-Plus-Glyph Rule.** No price direction is ever shown by color alone. Every
`.tckr-delta--up`/`.tckr-delta--down` pairs its color with a leading `▲`/`▼` glyph, so
the ~1-in-12 colorblind viewer still reads the direction. This is a hard product
requirement (see PRODUCT.md), not a style preference.

**The Tinted-Never-Solid Rule.** A status surface (LIVE/DELAYED badges, the simulated
banner, connection warning/danger banners) is always its accent color mixed into the
base surface at 9–14% strength (`color-mix(in oklab, <accent> 9–14%, transparent)`),
bordered at roughly double that strength. A solid accent fill is reserved for the
inverted primary-button/active-pill pattern only (background = Text, not an accent color).

## Typography

**Display Font:** Roboto Mono (the hero price and stat values — this system's "display"
moments are numbers, not headlines)
**Body Font:** Archivo, with system-ui/-apple-system/Segoe UI/Roboto fallbacks
**Label/Mono Font:** Roboto Mono

**Character:** A trading-terminal pairing, not a headline/body pairing: Archivo carries
language (brand, copy, names, buttons), and Roboto Mono carries every number, symbol,
timestamp, and machine-read value — including, distinctively, the biggest text on the
page (the detail view's hero price). The mono face is the one that gets top billing at
the moments that matter most.

### Hierarchy
- **Display** (600, `2.4rem`, tight leading, `-0.02em` tracking, tabular-nums): the
  stock-detail hero price. The one number the page exists to show.
- **Headline** (700, `1.4rem`, `-0.01em` tracking, mono): the symbol identity on the
  detail page (e.g. `COMI`).
- **Title** (800, `1.05rem`, `-0.02em` tracking, sans): the `Tckr` brand mark in the
  header — the only place display weight goes to the sans face rather than mono.
- **Body** (400–500, `0.78–0.85rem`, 1.4–1.55 line-height, sans): table cells, search
  input, banner/detail copy, button labels.
- **Label** (600, `0.6–0.72rem`, `0.09–0.14em` tracking, uppercase where used, mono):
  table column headers, badges, stat labels, the tape tag, the "TAPE HELD" overlay.

### Named Rules
**The Mono-Is-For-Machines Rule.** Anything a machine produced or a user would compare
digit-by-digit — a price, a symbol, a volume, a timestamp, a percentage — is set in
Roboto Mono with `font-variant-numeric: tabular-nums`. Anything a human wrote — labels,
copy, names, button text — is Archivo. The two never trade places.

## Layout

Single-column, content-first layouts with no persistent sidebar or multi-pane chrome.
The stock list is a full-width, fixed-layout table (`table-layout: fixed`, cells
ellipsis-truncate rather than wrap) inside a bordered, tonal card; the detail page caps
at `max-width: 760px` and reads top-to-bottom as one narrative: identity → price →
timeframe tabs → chart → OHLC/volume/lot/tick stat strip (a 3-column grid below 480px,
6-column above it).

One primary breakpoint, **640px**: above it the header is one row (brand left,
status/badge slots right) and the list table shows all eight columns; below it the
header stacks into two rows, page padding drops from 16px to 12px, and the table sheds
five secondary columns (Last 60s, Name, Change, Volume, Last update) down to Symbol,
Price, and Change % — the three a user cannot lose. A second, narrower breakpoint at
**400px** shrinks the chart's readout text. No selector anywhere sets a `min-width`
above 320px.

Padding and gaps are drawn from a loose scale rather than a formal spacing token
(observed values cluster at 4, 6, 8, 9, 10, 11, 12, 14, 16, 18, 20px) — dense controls
(pills, badges, table cells) sit at the small end (5–11px), containers and section
margins at the large end (14–20px).

## Elevation & Depth

Flat by construction — there is no `box-shadow` anywhere in this codebase. Depth is
conveyed two ways instead: **tonal layering** (`surface` for the page, `surface-raised`
one step up for anything that sits "on" it — table headers, chart body, stat cells,
the search box) and **1px hairline borders** (`--tckr-color-border`) separating every
card, table, input, and section. A status surface adds a third, temporary layer — a
`color-mix` tint of its accent color at 9–14% strength — but that is a color signal, not
an elevation one; it never implies the element is physically raised.

### Named Rules
**The No-Shadow Rule.** This system conveys "this is a distinct surface" with a border
and/or a tone shift, never a shadow. A future component that reaches for `box-shadow`
has left the system.

## Shapes

A tight, granular radius scale rather than a clean 3–4 step system: **2px** (the
header's square brand mark), **3px** (the price-flash background), **4px** (the `⌘K`
key-hint chip), **5px** (badges, sort buttons' focus ring, table-row focus outline
offset), **6–7px** (action buttons — connection-banner CTA, empty-state actions), **8px**
(the search box), **9–10px** (cards: connection banners, the delayed note, the OHLC
stat grid, the ticker tape, the table wrapper, the chart body), and **999px** (fully
round — filter/preset pills only). Nothing in the system uses a 0px (sharp) corner;
the floor is 2px. Borders are always 1px hairlines, never thick or doubled.

## Components

Components are quietly technical and unhurried: a small, disciplined set of primitives,
each doing exactly one job, with motion reserved for moments that carry real information
(a tick changed, the connection state changed) rather than for decoration.

### Buttons / Action Controls
- **Shape:** 5–7px radius depending on context (timeframe tabs and sort-adjacent
  controls sit at 5px; banner/empty-state call-to-actions at 6–7px); filter/preset pills
  are fully round (999px).
- **Primary / active state:** background = Text, text = Surface (a hard color
  inversion, never an accent color) — used for the active filter pill, the active
  timeframe tab, and every button-styled call to action (Retry now, Reconnect, Clear
  search).
- **Ghost / inactive state:** transparent background, Text Muted label, 1px Border
  outline; becomes the primary state's color pair only on selection/activation, not on
  hover.
- **Focus:** a 2px solid Terminal Mint outline (`outline-offset: 2px`, or `-2px` for a
  table row) — the accent color's only interactive use.

### Badges
- **Style:** small pills (5px radius), mono uppercase-tracked text, 1px border in the
  same accent at higher opacity than the fill.
- **Live:** Terminal Mint text/border on a 14%-mint tint, with a filled dot before the
  label on the detail page.
- **Delayed:** Amber Caution text/border on a 13%-amber tint.
- **Neutral (e.g. "SIMULATED DATA"):** shares the Delayed badge's amber styling — this
  system has no separate neutral-gray badge variant.

### Cards / Containers
- **Corner style:** 9–10px for anything card-shaped (connection/delayed-note banners,
  ticker tape, table wrapper, chart body, OHLC stat grid).
- **Background:** Surface Raised for anything sitting "above" the page (table headers,
  search box, chart body, stat cells); Surface itself for the table body and card shells.
- **Shadow strategy:** none — see Elevation & Depth.
- **Border:** always the 1px hairline Border token.
- **Internal padding:** 9–14px for most cards; 12px for stat cells.

### Price Cell (signature component)
The one component every price or signed decimal on screen renders through — never
formatted ad hoc elsewhere. Tabular-nums mono text; a pre-tick/no-data state renders
de-emphasized italic Text Muted rather than a spinner or a fake `0.00`. On every value
change it plays a 900ms ease-out flash: the text's background pulses a 28%-strength tint
of the move's direction color while an arrow glyph fades in and out over the same
window — the system's primary "something just happened" signal, deliberately brief and
non-repeating rather than a persistent blink.

### Ticker Tape (signature component)
An auto-scrolling marquee of every symbol's price and change, looping via a 32-second
linear `translateX` animation (duplicated content for a seamless loop). When the
connection goes stale, the track desaturates to 30% saturation, dims to 32% opacity,
freezes mid-scroll (`animation-play-state: paused`), and a centered "TAPE HELD" label
fades in over an edge-masked gradient — the tape's held state is the single clearest
visual signal that data has stopped moving.

### Sparkline (signature component)
A 20-point bounded inline SVG polyline per list row — no axis, no fill, no gridlines,
1.6px stroke colored by the symbol's current direction (mint/coral/muted-flat). Purely
decorative: it never carries a number a user could read as text; every price a user
reads as text still goes through Price Cell.

### Table Rows
- **Default:** no visible separation beyond the shared 1px row-bottom border.
- **Hover:** background steps to Surface Raised.
- **Focus-visible:** a 2px Terminal Mint outline, offset -2px (inset, since the row is a
  block-level target).
- **Stale state:** when the connection is reconnecting/closed, the whole table fades to
  72% opacity rather than freezing individual cells.

### Inputs
- **Style:** the visual "field" is the surrounding label, not the `<input>` itself —
  an 8px-radius, Surface Raised, 1px-bordered wrapper holds a search icon, an unstyled
  (`all: unset`) input, and a trailing `⌘K` key-hint chip (4px radius, mono, bordered).
- **Focus:** no distinct treatment is defined on the wrapper itself today — the input
  relies on the browser default; this is the one control in the system without an
  explicit focus-visible rule (a residual gap, not a documented choice).

### Navigation
There is no persistent nav chrome. "Navigation" is a single `← All instruments` text
link back to the list (Text Muted, no underline, darkens to Text on hover) plus
symbol-row activation (click or Enter/Space) into the detail route.

## Do's and Don'ts

### Do:
- **Do** pair every colored delta with its `▲`/`▼` glyph — never color alone (The
  Color-Plus-Glyph Rule).
- **Do** render every status surface (badges, banners) as a `color-mix` tint at
  9–14% strength over the base surface, bordered at roughly double that strength — never
  a solid accent fill (The Tinted-Never-Solid Rule).
- **Do** route every displayed price or signed decimal through Price Cell; nothing else
  formats a `DecimalString` for display.
- **Do** keep Roboto Mono for anything numeric or machine-read and Archivo for anything
  a human wrote (The Mono-Is-For-Machines Rule).
- **Do** separate surfaces with a 1px Border hairline or a tone shift (Surface →
  Surface Raised) — never a shadow (The No-Shadow Rule).

### Don't:
- **Don't** introduce a `box-shadow` anywhere — this system has none, by construction.
- **Don't** give a status badge or banner a solid, fully-opaque accent background.
- **Don't** let a decorative element (the ticker tape, a sparkline) become a second
  source of truth for a price — its own numeric conversion must never reach the page as
  text, only as pixel geometry or an already-Price-Cell-formatted string.
- **Don't** shorten the 900ms price-flash duration or swap its ease-out timing without
  checking it still reads as "quietly technical, unhurried" rather than jarring.
- **Don't** use a 0px (sharp) corner anywhere — the system's radius floor is 2px.
- **Don't** treat the dark theme as optional chrome: `data-theme="dark"` is the shipped
  default, and light mode is a plain fallback for an explicit override, not the
  design's primary expression.
