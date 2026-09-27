---
name: Tckr Market Watch
description: A light-first, frosted-glass market-watch client for the Egyptian Exchange. Translucent panels float over a softly glowing field, numbers are set crisp in IBM Plex Mono, and every up/down signal carries a glyph or sign as well as a colour.
colors:
  exchange-green: "#0f7a4d"
  brick-red: "#c0392b"
  session-amber: "#8a5a00"
  ink: "#14181f"
  slate: "#5b6472"
  paper: "#ffffff"
  paper-raised: "#f4f5f7"
  hairline: "#d8dbe1"
  frost-top: "#f2f4f3"
  frost-bottom: "#e8ebea"
  glass: "rgba(255, 255, 255, 0.58)"
  glass-strong: "rgba(255, 255, 255, 0.78)"
  glass-edge: "rgba(20, 24, 31, 0.12)"
  glass-card: "rgba(255, 255, 255, 0.58)"
  glass-card-edge: "rgba(255, 255, 255, 0.88)"
  glass-stat: "rgba(255, 255, 255, 0.7)"
  glass-stat-edge: "rgba(255, 255, 255, 0.9)"
  chip-text-up: "#0d6841"
  chip-text-down: "#a33025"
  glow-mint: "rgba(63, 215, 156, 0.55)"
  glow-coral: "rgba(255, 150, 125, 0.5)"
  glow-periwinkle: "rgba(150, 180, 255, 0.4)"
  logo-ink: "#14181f"
  logo-candle: "#0f7a4d"
typography:
  display:
    fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "3.25rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: "'tnum'"
  headline:
    fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "0.01em"
  price:
    fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.1
    fontFeature: "'tnum'"
  title:
    fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.2
    fontFeature: "'tnum'"
  body:
    fontFamily: "'Instrument Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  small:
    fontFamily: "'Instrument Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
  caption:
    fontFamily: "'Instrument Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.14em"
  wordmark:
    fontFamily: "'IBM Plex Mono', monospace"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 0.92
    letterSpacing: "-0.02em"
rounded:
  flash: "3px"
  chip: "5px"
  control: "7px"
  stat: "16px"
  table: "18px"
  card: "20px"
  panel: "22px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "12px"
  lg: "14px"
  xl: "16px"
  2xl: "24px"
components:
  pill-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "7px 12px"
  pill-inactive:
    backgroundColor: "transparent"
    textColor: "{colors.slate}"
    rounded: "{rounded.pill}"
    padding: "7px 12px"
  button-action:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  range-pill-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "7px 14px"
  range-pill-inactive:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.slate}"
    rounded: "{rounded.pill}"
    padding: "7px 14px"
  search-field:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "10px 14px"
  hero-card:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "16px 18px 15px"
  detail-panel:
    backgroundColor: "{colors.glass-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "22px 24px"
  stat-tile:
    backgroundColor: "{colors.glass-stat}"
    textColor: "{colors.ink}"
    rounded: "{rounded.stat}"
    padding: "13px 15px"
  table-card:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.ink}"
    rounded: "{rounded.table}"
  change-chip-up:
    backgroundColor: "color-mix(in oklab, {colors.exchange-green} 20%, transparent)"
    textColor: "{colors.chip-text-up}"
    rounded: "{rounded.chip}"
    padding: "4px 8px"
  change-chip-down:
    backgroundColor: "color-mix(in oklab, {colors.brick-red} 20%, transparent)"
    textColor: "{colors.chip-text-down}"
    rounded: "{rounded.chip}"
    padding: "4px 8px"
  connection-pill-connected:
    backgroundColor: "color-mix(in oklab, {colors.exchange-green} 16%, {colors.glass})"
    textColor: "{colors.exchange-green}"
    rounded: "{rounded.pill}"
    padding: "7px 13px"
---

# Design System: Tckr Market Watch

## Overview

**Creative North Star: "The Frosted Trading Floor"**

Tckr Market Watch is a live EGX board seen through frosted glass. The page rests on a pale
mineral gradient, the Frost field. Three large, heavily blurred colour glows sit behind
it: mint top-right, coral centre, periwinkle bottom-left. Every working surface floats on
that field as a translucent pane: the header, the connection pill, the banners, the
search field, the hero cards, the instrument table, the detail panel and its stat tiles.
The glass is soft but the content is not. Prices, symbols, volumes and timestamps are set
crisp and tabular in IBM Plex Mono and sit in front of the blur. The light behind the
panes suggests warmth and motion; the numbers stay still, sharp and exact.

The system is light-first. Light is the resting state (`index.html` resolves a stored
choice, then the OS preference, then light). Dark is a full counterpart rather than an
afterthought: the same panes become smoked glass over a near-black field, and the glows
drop to about half strength. Colour is disciplined. Exchange Green means up, live,
connected or selected. Brick Red means down or disconnected. Session Amber means waiting,
reconnecting or delayed. None of the three is ever decoration, and each always comes with
a non-colour signal. Motion is brief and physical: short ease-out reveals, a 500ms flash
when a price changes, a gentle lift on hover, and a press that scales to 96%.

This system rejects the old "Night Terminal" look: no dark-only default, no shadowless
hairline cards, no marquee ticker tape.

**Key Characteristics:**
- Light-first frosted glass. Translucent panes (58–78% white, 20–26px backdrop blur, 1.5–1.6×
  saturation) float over a gradient field lit by three blurred colour glows.
- Two voices. IBM Plex Mono carries every number, symbol, label and badge; Instrument Sans
  carries names, sentences and control text.
- Soft, generous corners that scale with a surface's importance (5px chips → 16px stat
  tiles → 18–22px cards), and fully round pills for every control and status.
- Every glass surface has an opaque, blur-free fallback for reduced transparency and
  increased contrast.
- Up/down is never colour alone: an arrow glyph or an explicit +/− sign always rides along.

## Colors

A cool, near-neutral light palette with three disciplined signal hues. All three are
darkened for AA contrast on light glass and re-tuned brighter for dark mode.

### Primary
- **Exchange Green**: up moves, the connected pill, the LIVE badge and their dots (while EGX
  trades; closed, all step down to neutral, since a green dot means "trades are moving" —
  the badge keeps the word LIVE), the selected table
  row's 3px inset bar and 12% tint, the chart line and its fill on an up session, and the focus-ring
  accent (`--tckr-color-accent`). In dark mode it becomes the mint `#3fd79c`. The logo's
  candle uses the same green, and in the logo it never changes with price direction.

### Secondary
- **Brick Red**: down moves (including the chart line and its fill on a down session), the
  disconnected pill and banner, and close-code errors. In
  dark mode it becomes coral `#f2705f`. It is never used for emphasis or decoration.

### Tertiary
- **Session Amber**: the connecting/reconnecting pill, the "stream dropped" banner, and the
  "You are on the delayed stream" note. It means "not the live, trusted state". In dark
  mode it becomes `#d9a441`.

### Neutral
- **Ink**: primary text, and the fill for every active pill, range pill and action button
  (inverted against Paper). In dark mode it becomes off-white `#f2f1ee`.
- **Slate**: secondary text, placeholders, inactive pill labels, column headers, and
  flat sparklines. In dark mode it becomes `#9296a0`.
- **Paper / Paper Raised**: the opaque surfaces behind glass fallbacks, inactive range
  pills, chart readout chips, and the chart's loading overlay. In dark mode they become
  `#0c0d0e` / `#17181a`.
- **Hairline**: 1px borders on non-glass controls (pills, the ⌘K key hint, action
  buttons). Glass surfaces use Glass Edge instead.
- **Frost Top → Frost Bottom**: the page gradient at 170°. In dark mode it runs
  `#0b0d0e → #101214`.
- **Glass family** (glass, glass-strong, glass-card, glass-stat and their edges): the
  translucent pane fills. Stat tiles and the detail panel are deliberately a touch more
  opaque, with near-white edges, so the numbers that matter most sit on the calmest glass.
- **Glow Mint / Coral / Periwinkle**: the three fixed, 70px-blurred radial blobs behind
  everything. They are atmosphere only and are hidden below 640px.
- **Chip Text Up / Down**: darker green and red, used only for text on light-tinted change
  chips, where the plain signal colours fall under 4.5:1. In dark mode, up falls back to the
  plain mint, and down uses a slightly lifted coral (`#f47d6e`), because plain coral
  measured 4.34:1 on the 20% down tint.

### Named Rules
**The Always-Visible Stream Rule.** Which stream the user is on (LIVE or DELAYED) is shown
in the header on every screen, from the server's `identity()` only. A status that matters
this much is never a caption on one view. On the DELAYED stream the page repeats it above
every price it shows: a "Delayed prices · 15s behind" banner (9% amber tint, 24% border,
lighter than the "stream dropped" warning, because it is an entitlement, not a fault) sits
first in the banner stack, above the highlight cards, the board and the detail pane. Each
highlight card's label and each row's last-update time carry an amber clock, and their
accessible names end in ", delayed stream". The detail says it once more, inline, in its
"as of" line. On phones the header badge keeps the duration ("DELAYED 15s").

**The Color-Plus-Signal Rule.** No price direction is shown by colour alone. Change
cells lead with ▲/▼. Change-percent chips and delta pills always print an explicit
+ or − sign. The price flash fades in an arrow beside the tint. This is a product
requirement, not a style preference.

**The Tinted Status Rule.** A status surface mixes its signal colour into the glass,
never into a solid fill: 16% into `--tckr-glass-bg` for connection pills and banners,
with the border at 32%. The delayed note uses 9% with a 24% border. A solid fill is
reserved for the inverted Ink selection pattern.

**The Always-Green Candle Rule.** The logo's candle is Exchange Green (mint on dark),
whatever the market is doing.

## Typography

**Display Font:** IBM Plex Mono 600 (the display moments here are numbers)
**Body Font:** Instrument Sans (with system-ui / -apple-system / Segoe UI / Roboto fallbacks)
**Label/Mono Font:** IBM Plex Mono (with ui-monospace / SFMono-Regular / Menlo fallbacks)

**Character:** A humane grotesque paired with an engineered mono. Instrument Sans gives
company names and sentences a warm, contemporary voice. IBM Plex Mono gives every
figure a squared, instrument-panel precision and takes top billing at the biggest sizes.

### Hierarchy
The scale has eight steps, each a Tailwind role utility (`text-label` … `text-display`,
defined in `src/styles/tailwind.css`). Components never use arbitrary `text-[…]` sizes.
When two jobs share a step, weight and tone separate them rather than an in-between size.

- **Display** (600, 3.25rem, −0.02em, tabular): the detail panel's hero price. The one
  number the page exists to show.
- **Headline** (600, 1.875rem, +0.01em): the symbol on the detail panel (e.g. `COMI`).
- **Price** (600, 1.5rem, tabular): hero-card prices.
- **Title** (600, 1.25rem): hero-card symbols, stat-tile values, and the empty-state
  heading (Instrument Sans).
- **Body** (400, 1rem, 1.5): table cells, company names beside a symbol, and the detail
  delta pills (mono 600).
- **Small** (0.875rem): banner and note titles (600, Ink), the search input, empty-state
  copy, and the chart's loading message. On coarse pointers the search input steps up
  to Body (16px) so iOS doesn't zoom on focus.
- **Caption** (0.75rem): every control label (filter, range and action pills), chart
  readouts, the "as of" line, hero-card company names, and banner/note detail lines
  (400, Slate) under a Small title.
- **Label** (600, 0.6875rem, mono, tracked 0.08–0.14em): column headers, hero-card
  kickers, stat labels, hero badges, the connection pill and the ⌘K hint. This is the
  floor; nothing in the interface is smaller.
- **Wordmark**: "ckr" in IBM Plex Mono 600 at 24px, −0.02em, 0.92 line-height, bottom-aligned
  with the candlestick mark.

**Loaded weights:** Instrument Sans 400/500/600 and IBM Plex Mono 400/600, both with
`display=swap`. No italic or 700 cut is loaded, so the system never uses `font-bold` or
`italic`, which would make the browser synthesize them.

### Named Rules
**The Mono-Is-For-Machines Rule.** Anything a machine produced or a user compares
digit by digit is IBM Plex Mono with `tabular-nums`: prices, symbols, volumes,
percentages, timestamps, tick and lot sizes. Anything a person wrote is Instrument Sans.
The two never trade places.

**The Tracked-Label Rule.** Small mono labels are always tracked wide (0.08–0.14em) and set
in Slate; they name a value and never compete with it.

**The Real-Weights Rule.** Emphasis tops out at semibold (600), the heaviest cut loaded.
`font-bold` and `italic` would render as browser-synthesized fakes, so neither is used.

## Layout

The app has a sticky glass header (logo left; connection pill and theme toggle right) over
a single page with 16px padding. The list page reads top to bottom: status banners
(pill-shaped, full width), then three hero cards (Top Gainer / Top Loser / Most Active)
in an auto-fit grid (min 220px; below 640px a swipeable row, the next card peeking in,
so the board starts on the first screen; while EGX is closed each card's label names the
session's weekday, "TOP GAINER · THU"), then a row of order pills (Exchange order, the
lit default and the way back from any sort; Most active; Gainers; Losers) with a
flexible search field,
then the instrument table in one glass card. The table is a dense board:
- **Row height:** about 40px (8px × 12px cell padding around a 24px line), 44px on touch.
- **Caption:** the table's `<caption>` says what order it is in: "Exchange order" by
  default (the feed's own listing), a preset's name and what it ranks by, or "Sorted by
  Price, highest first" (numeric headers sort highest-first on the first click). While a
  search filters the board it leads with the count, "2 of 34 · Exchange order", and a
  polite live region announces it.
- **Decimal alignment:** EGX tick sizes differ by price band, so Price and Change mix
  precisions (`246.3`, `85.60`, `6.129`). Narrower values are padded with blank `ch`
  width (never extra zeros), so every decimal point lines up.
- **Alignment:** numeric columns (Price, Change, Change %, Volume, Value) right-align both
  their figures and their headers. Value's header carries its unit, "VALUE EGP".
- **Value:** traded value this session in EGP (price × shares, exact decimal arithmetic),
  compact with fixed two decimals so a column of them lines up ("25.16M", "18.60M").
  Volume is shares; Value is money, and it is what Most active ranks by.
- **Live-only columns:** Last update is shown only while EGX trades. Once closed, every
  row would read the same, so the column is left out and the Market closed banner says it
  once; the remaining columns rescale to fill the row.
- **Overflow:** cells truncate with an ellipsis instead of wrapping.
- **Right edge:** the table card ends flush with the search row. The split shell's 16px
  gap exists only while the detail pane is open.

Opening a symbol turns the page into a **split pane** without remounting the list. The
hero cards leave the layout, the list narrows to a fixed 380px column showing only
Symbol / Price / Change %, and the detail pane appears beside it, all in a single
layout change. The motion is a **view transition** over snapshots of three named regions:
- The list morphs to its column over 420ms. It is clipped from the right edge, never
  stretched.
- The hero cards fade out over 200ms.
- The detail pane slides in 16px while fading over 420ms.

Switching from one open symbol to another cross-fades the detail pane the same way.
Every one of these transitions is **element-scoped** to `<main>`
(`Element.startViewTransition`, provided through `TransitionScopeContext`): only the page
content is snapshotted and animated, while the sticky header stays live, on top, and
frosted over whatever moves beneath it. `<main>` carries `view-transition-scope: all`, so
its region names never leak into a document-wide transition.

No layout property is ever animated. Under reduced motion, or in browsers without
element-scoped view transitions, the change is instant. The detail pane stacks the identity + price panel
(with range pills, a × close button and the chart, 340px tall) above two groups at two
weights: the session figures as four stat tiles (Open, High, Low, Volume; auto-fit, min
120px), and the instrument's fixed trading rules as a quiet mono caption line beneath
them ("LOT SIZE 100 · TICK SIZE 0.05"). The two change pills wrap as one unit, so on a
narrow pane the move sits beneath the price as one fact rather than splitting.

Breakpoints:
- **800px:** the split pane stacks, and the list column hides while a detail is open.
- **640px:** the header stacks into two rows, page padding drops to 12px, the background
  glows are removed, hero cards stack, and the table sheds Session trend, Name, Change, Volume,
  Value and Last update, down to Symbol / Price / Change %.

Spacing follows a small, repeated scale: 6px between pills, 10–12px inside controls and
cells, 14px between stacked sections, 16px page gutters and pane gaps, and 22–24px inside
the detail panel.

## Elevation & Depth

Depth is **layered glass**. A surface reads as "in front" because it is translucent,
blurred and saturated over the colour field behind it, not because it casts a shadow.
The panes blur what's behind them at 20–26px and saturate it 1.5–1.6×, so the glows
turn into soft colour inside each pane. Shadows exist but are ambient. They are long,
very soft and pulled in hard (negative spread), and they only separate the main cards
from the field. They never stack or describe state. The two exceptions are the
selected row's inset green bar and the connected pill's faint green glow, and both are
signals rather than elevation.

### Shadow Vocabulary
- **Float** (`--tckr-shadow-float`, the `shadow-float` utility): `0 10px 24px -16px
  rgba(20,24,31,0.3)`, black at 0.55 in dark mode. One short, soft, pulled-in shadow for
  every glass card (hero cards, the instrument table, the detail panel), so a pane lifts
  off the field without a wide halo around its thin edge.
- **Selected bar** (`inset 3px 0 0 var(--tckr-color-up)`): the open symbol's row.
- **Live glow** (`0 4px 14px color-mix(in oklab, var(--tckr-color-up) 30%, transparent)`):
  the connected pill only.

### Named Rules
**The Glass-Needs-A-Field Rule.** Glass only works over something. Panes sit on the Frost
gradient and its glows. Never put a glass pane over a flat, opaque surface, where it
reads as a grey smear.

**The Opaque Fallback Rule.** Every glass surface declares `reduced-transparency:` and
`contrast-more:` fallbacks that swap to opaque Paper and drop the blur and saturation.
A new glass component without both fallbacks is incomplete.

## Shapes

The form language is soft and pebble-like. Radius grows with a surface's size and
importance:
- 3px: the price-flash highlight.
- 5px: change chips.
- 6–7px: action buttons and chart readout chips.
- 16px: stat tiles and the chart's clip.
- 18px: the table card.
- 20px: hero cards.
- 22px: the detail panel.

Every interactive control and every status is a full pill (999px): filter and range pills,
the search field, connection banners, the connection pill, the theme toggle (a 30px
circle) and hero-card badges. Borders are always 1px; there are no sharp corners.

## Components

Quietly tactile. Controls press in (scale 0.96; 0.92 for the theme toggle), cards lift
2px on a fine-pointer hover, and the selected state is always the same Ink-on-Paper
inversion.

### Buttons
- **Shape:** full pill for filter and range pills; 7px for action buttons (empty-state
  actions); 6px for the banner's Retry/Reconnect action.
- **Primary / active:** Ink background, Paper text, 600 weight. This is the only solid fill
  in the system.
- **Inactive / ghost:** transparent (filter pills) or Paper Raised (range pills), Slate
  label, 1px Hairline border, 500 weight.
- **Hover / Focus:** hover only on fine pointers (`fine-hover`). Focus is a 2px accent
  outline offset 2px (−2px inset on table rows). The search field is the exception: an
  accent border plus a soft 3px halo (`--tckr-field-focus-border` / `-halo`: full accent
  and 24% in light, 70% and 12% in dark), because a 2px mint ring around a full-width pill
  read as an alert in dark mode. It uses its own clear (×) button in
  place of the browser's native one. Press scales to 0.96 over 120ms ease-out.

### Chips
Every signed change (the board chip, the hero badge, the detail pills) shares one colour
recipe (`components/deltaTone.ts`): a 20% tint of the signal colour behind the AA-checked
chip text, or neutral Paper Raised when flat. Only the shape differs by context.
- **Change chip (table, list column):** 5px radius, a 24px-tall line, mono tabular, and an
  explicit +/− sign. Percentages carry two decimals everywhere (board, hero cards, detail), so one
  move never reads as +0.6% in one place and +0.59% in another. A move under 0.005%
  renders as a neutral Paper Raised "0.00%" with no sign, because it rounds to zero and
  a coloured "-0.00%" would claim a direction the figure can't show.
- **Delta pill (detail):** full pill, Body-size mono 600, no border. The change-amount pill leads
  with a small ▲/▼, like the board's Change column; the percent pill carries its sign.
- **Stat tile labels:** uppercase tracked Label (0.14em), the same voice as the table
  headers: OPEN, HIGH, LOW, VOLUME, LOT SIZE, TICK SIZE.
- **Hero badge:** full pill, Label-size mono 600, the same up/down tint. Most Active ranks by
  traded value, as EGX reports activity, and shows it in a neutral badge ("EGP 25.16M").

### Cards / Containers
- **Corner style:** 20px for hero cards, 22px for the detail panel, 18px for the table
  card, 16px for stat tiles.
- **Background:** Glass (58% white) for hero and table cards. The detail panel uses Glass
  Card with a near-white edge and 26px blur. Stat tiles use Glass Stat (70% white) with a
  20px blur.
- **Shadow strategy:** Card float / Table float only (see Elevation & Depth).
- **Border:** 1px Glass Edge, or near-white edges on the detail panel and stat tiles.
- **Internal padding:** 16–18px for hero cards, 22–24px for the detail panel, 13–15px for
  stat tiles.

### Inputs / Fields
- **Style:** the search field is a glass pill (10px × 14px padding) holding a muted search
  icon, an unstyled input (Small, Body on coarse pointers) and a trailing ⌘K key-hint chip
  (mono Label, 4px radius, Hairline border; hidden on coarse pointers).
- **Focus:** `focus-within` draws the 2px accent outline, offset 2px, around the whole pill.

### Navigation
There is no nav chrome beyond the logo, which links home. In the split view an
"← All instruments" pill leads the filter row, and rows open a symbol on click, Enter or
Space.

### Stream Badge (signature component)
The header's first pill, and the product's most important status. It shows the
server-assigned entitlement from `identity()`, never a client-side default:
- **LIVE:** Exchange Green tint and a 6px dot.
- **DELAYED · 15s:** Session Amber tint and a drawn clock. The label shows the delay
  honestly: the simulated offset marked "simulated", or "15 min" on a real gateway. The
  offset drops below 640px.

It renders nothing until the server has identified the stream. It is mounted on every
screen, so a delayed price is never mistaken for a live one. When the entitlement flips
mid-session, the pill plays one ring pulse in its own colour (900ms). That is the only
status change in the product that asks for the eye. The change is also announced through
a persistent `role="status"` wrapper. It never pulses on first paint.

### Connection Pill (signature component)
A mono label pill beside the stream badge ("Connected · 2s") with a 6px status dot,
tinted per state:
- **Connected while EGX is trading:** green with the Live glow. The pill cross-fades
  (250ms) between all of its states rather than snapping.
- **Connected while EGX is closed or in pre-open:** neutral glass with Slate text and no
  glow, because nothing is streaming.
- **Connecting or reconnecting:** amber.
- **Closed:** red.

The elapsed time drops below 640px so the header stays one row.

Its big sibling, the connection banner, is a full-width glass pill that drops in (220ms,
from −6px) with a drawn icon, a title, a Slate detail line and an Ink action button. The
market banner uses the same pill. It says "Market closed", or "Pre-open auction" from
09:30 to 10:00 Cairo.

### Icons
Drawn SVG icons from `src/components/icons.tsx` (clock, retry, alert, search, arrow-left).
All sit on a 16px grid with a 1.6 stroke, use `currentColor` and are `aria-hidden`.
Unicode glyphs are never used as icons; ▲/▼ remain as direction text, not icons.

### Moments (earned, never on first paint)
Operate-mode delight lives at the moments that matter, not on routine clicks. Each one
says something true and useful, then gets out of the way:
- **Waiting:** the market-closed banner counts down to the bell, coarse on purpose
  ("in 1d 5h", "in 12m"), because it describes a wait rather than acting as a timer.
- **The opening bell:** if the page is open when EGX opens, an "EGX is open" banner
  appears with the candlestick mark (Exchange Green tint, auto-dismisses after 8s).
  It happens at most once a day.
- **Recovery:** after a dropped stream reconnects, a "Reconnected" confirmation shows
  for 4s, so recovery is confirmed rather than inferred from a warning that vanished.
- **A search that finds nothing** suggests up to three closest instruments (edit
  distance on ticker and name words, ticker matches first) as "Did you mean" buttons
  that open the symbol. An unrelated query gets no suggestions.
- **Mastery:** a shortcut hint (↑ ↓ · Home End · Enter · ⌘K) appears under the table
  only while a row has keyboard focus, and never on touch.

Moment banners share the banner pill, with a 12% up tint and a quiet "Dismiss" text
button.

### Board re-rank motion (signature)
When the row order changes, each row that moved glides from its old rank to its new one.
That covers a preset or header sort, the 30-second re-rank of an active sort, and a search
narrowing the list. The glide is a FLIP, transform only, 420ms with the system ease.
Rows are transparent over the glass, so a moving row carries a near-opaque surface
through the flight and hands back to its own background as it lands. Rows newly in the
list fade in (200ms). This is the product's authored motion: the market visibly
rearranging the board, so a watched symbol is never lost to a teleport. Under reduced
motion rows reorder instantly.

### Theme switch
A user-initiated theme change applies as one piece. Per-element colour transitions are
suppressed for its duration, and where view transitions exist the whole page
cross-fades once (280ms). The toggle uses drawn sun and moon icons.

### Table keyboard model
The instrument table is a single Tab stop (roving tabindex). ↑/↓ move between rows,
Home/End jump to the ends, and Enter/Space open a row. With a detail open, the pane follows
the focused row, and Escape (or the pane's own × button, or "All instruments") closes it.
⌘K on Apple platforms, Ctrl+K elsewhere, and "/" focus the search; no page shortcut fires
while typing in a field. "Skip to instruments" is the first Tab stop on every page, ahead
of the logo, and lands on the board's current row. Focus is never dropped: if opening
hides the focused row (phones), it moves to the detail's heading; if closing removes it,
it returns to that symbol's row. While a row has keyboard focus, a glass legend floats at
the bottom of the viewport with the keys (Esc only when a detail is open); screen readers
get the same model as the table's description. In split view the collapsed hero cards are
`inert`, and opening a symbol is announced politely to screen readers.

### Price Cell (signature component)
Every displayed price or signed decimal goes through Price Cell. It is mono and tabular,
and a no-data state renders as a Slate "—" rather than a fake zero. On each
change it replays a 500ms ease-out flash: a 28% signal-colour tint behind the digits
(3px radius) with an arrow that holds, then fades.

### Sparkline (signature component)
A 20-point inline SVG polyline with a 1.6px stroke coloured by direction (green, red or
Slate when flat). It has no axis and no fill, is decorative only, and never renders a
number as text. It appears in the table's Session trend column (24px tall, 20 points) and in
hero cards (96 × 30px, 26 points). Both are seeded once from each symbol's session
history, downsampled, with the live price as the last point, so they show the session's
shape from first paint rather than starting flat.

### Price Chart
A uPlot line drawn straight onto the detail panel's glass, clipped to a 16px radius (no
separate chart card): a 2.5px line over a 14% area fill, and 1px hairline
horizontal gridlines. A sparse Cairo-time axis runs along the bottom (`HH:MM` for
SESSION, `HH:MM:SS` for 60S/5M), always labelling both ends of the plotted span (10:00
and 14:30, even on a phone) with interior steps only where they fit, and a price axis sits on the right, both in 11px Plex
Mono in the muted token with no tick marks. Two tags hang off the plot onto the price
axis: the last plotted price, filled in the line colour, and on SESSION the session open
(the baseline the page's change figures use), "Open 85.10" on Paper Raised, marking a
dashed muted line across the plot. On the axis, never inside the plot, so the line can't
run through them; when the two would overlap, the Open tag steps one tag-height aside, and
axis labels under a tag are left blank. The y range always includes the open. The area under
the line is one 14% tint of the line's own colour, down to the frame, on every range. A quiet range is widened to at least 1% of the price, so a small wiggle never
fills the frame like a crash. The only corner chip names the slice of time plotted
(`pages/chartRanges.ts`): "Last 60s" / "Last 5m" / "Today since 10:00" while EGX trades;
once closed, the ranges end at the session's close and read as a recap ("Final 60s · Thu
24 Sep", "Thu 24 Sep session · 10:00–14:30"). The session high and low live in the stat
tiles.

**The Session-Direction Line Rule.** The line, its whole area fill, the last-price tag and
the cursor dot take the session's direction, the same sign as the Change pills beside it: Exchange
Green when up on the open, Brick Red when down, Ink when unchanged (or before the first
quote). One colour for the whole series; it is never coloured per segment or per tick, and
it switches in place when the price crosses the open. The ▲/▼ on the change pill and the
dashed Open line carry the same fact without colour. Line,
gridline and axis colours are re-read from the tokens on every theme switch, so the canvas
follows light/dark in place.

### Logo
The candlestick "T" plus "ckr" lockup (see Typography › Wordmark), themed through
`--tckr-logo-ink` / `--tckr-logo-candle`. The mark is 1.15× the wordmark height, the gap
is about 0.06× the wordmark size, and the two are bottom-aligned.

## Do's and Don'ts

### Do:
- **Do** pair every coloured direction with ▲/▼ or an explicit +/− sign (The
  Color-Plus-Signal Rule).
- **Do** mix status colours into the glass (16% fill / 32% border) instead of filling
  solid (The Tinted Status Rule).
- **Do** give every new glass surface `reduced-transparency:` and `contrast-more:` opaque
  fallbacks (The Opaque Fallback Rule).
- **Do** set every figure in IBM Plex Mono with `tabular-nums` and every sentence in
  Instrument Sans (The Mono-Is-For-Machines Rule).
- **Do** use the Ink-on-Paper inversion for every selected or active control.
- **Do** gate hover effects behind `fine-hover` and give pressable controls the 0.96 press
  scale, with `motion-reduce` fallbacks on every reveal and transition.
- **Do** route every displayed price through Price Cell.
- **Do** keep the Stream Badge on every screen. The live/delayed distinction is never
  implied by colour alone or left to one view (The Always-Visible Stream Rule).
- **Do** draw icons from `icons.tsx`; never borrow a Unicode glyph as an icon.
- **Do** animate layout changes with a view transition or transform and opacity. Start
  every view transition through `runViewTransition` (`components/viewTransition.ts`),
  scoped to the smallest element that changes; navigation uses
  `useViewTransitionNavigate`. Never transition `width`, `height`, `max-height` or margins.

### Don't:
- **Don't** put glass over a flat opaque surface or strip the Frost field and glows from a
  desktop page (The Glass-Needs-A-Field Rule).
- **Don't** stack shadows or use them to express state. Card float and Table float are the
  only elevation shadows.
- **Don't** use a sharp (0px) corner or a border thicker than 1px.
- **Don't** colour the logo candle red or coral, or add "Market Watch" text to the lockup
  (The Always-Green Candle Rule).
- **Don't** recolour the price chart's line by direction. It is always the accent.
- **Don't** reintroduce the retired Night Terminal patterns: dark-only default, Roboto
  Mono/Archivo, the marquee ticker tape, or the permanent simulated-data banner.
