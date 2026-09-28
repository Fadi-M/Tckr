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
  chip-text-down: "#942a1f"
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
a non-colour signal. Motion is brief and physical: short ease-out reveals, changed digits
that roll into place when a price moves, a gentle lift on hover, and a press that scales to 96%.

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
+ or − sign. On the board, the price flash fades in an arrow beside the tint. In the
detail pane the flash is tint only, because the change pills beside the price already carry
the direction, and an arrow on a session High or Low would read as a claim about the value.
This is a product requirement, not a style preference.

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
  copy. On coarse pointers the search input steps up
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
percentages, timestamps. Anything a person wrote is Instrument Sans.
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
  polite live region announces it. It always names the change basis, "change vs previous
  close", and while EGX trades it ends with when the board last repainted, "updated
  14:20:30" (Cairo time; with the amber clock on the DELAYED stream).
- **Change basis:** Change and Change % are measured from the previous close, as EGX and
  its brokers quote them (the snapshot's `previousClose`, EGX's reference price; the
  session open when a feed doesn't send one). The detail pane shows the move since the
  open separately.
- **Decimal alignment:** EGX tick sizes differ by price band, so Price and Change mix
  precisions (`246.3`, `85.60`, `6.129`). Narrower values are padded with blank `ch`
  width (never extra zeros), so every decimal point lines up.
- **Alignment:** numeric columns (Price, Change, Change %, Volume, Value) right-align both
  their figures and their headers. Value's header carries its unit, "VALUE EGP".
- **Value:** traded value this session in EGP (price × shares, exact decimal arithmetic),
  compact with fixed two decimals so a column of them lines up ("25.16M", "18.60M").
  Volume is shares; Value is money, and it is what Most active ranks by.
- **No per-row update time:** every row repaints on the same beat, so a "Last update"
  column read the same on all 34 rows. The caption says it once instead.
- **Overflow:** cells truncate with an ellipsis instead of wrapping.
- **Right edge:** the table card ends flush with the search row. The split shell's 16px
  gap exists only while the detail pane is open.

Opening a symbol turns the page into a **split pane** without remounting the list. The
hero cards leave the layout, the list narrows to a fixed 380px column showing only
Symbol / Price / Change %, and the detail pane appears beside it, all in a single
layout change. The search field and the order presets move into the top of the list
column, over the list they act on, so the detail pane starts at the top of its own column
with nothing spanning the chart. The motion is a **view transition** over snapshots of three named regions:
- The list morphs to its column over 420ms. It is clipped from the right edge, never
  stretched.
- The hero cards fade out over 200ms.
- The detail pane slides in 16px while fading over 420ms.

Switching from one open symbol to another cross-fades the detail pane the same way.
Inside the pane, content lands in reading order (GSAP, 320ms each, 40–50ms apart): the
symbol and the range pills, then, once the first quote is in, the price row, the as-of
line and the four stat tiles. It replays on a symbol switch, never on a range change or
a tick. It runs inside the view transition's live "new" view, so it plays while the
pane slides in.
Every one of these transitions is **element-scoped** to `<main>`
(`Element.startViewTransition`, provided through `TransitionScopeContext`): only the page
content is snapshotted and animated, while the sticky header stays live, on top, and
frosted over whatever moves beneath it. `<main>` carries `view-transition-scope: all`, so
its region names never leak into a document-wide transition.

No layout property is ever animated. Under reduced motion, or in browsers without
element-scoped view transitions, the change is instant. The detail pane stacks the identity + price panel
(with range pills, a × close button and the chart, 340px tall) above the session figures
as four stat tiles (Open, High, Low, Volume; auto-fit, min 120px). The two change pills
sit vertically centred on the price and wrap as one unit, so on a narrow pane the move
sits beneath the price as one fact rather than splitting.

Breakpoints:
- **800px:** the split pane stacks, and the list column hides while a detail is open. A
  row above the detail keeps "← All instruments" plus previous/next symbol pills
  ("‹ ORAS", "SWDY ›"), which step through the board's current order.
- **640px:** the header stacks into two rows, page padding drops to 12px, the background
  glows are removed, hero cards stack, and the table sheds Session trend, Name, Change, Volume,
  Value, down to Symbol / Price / Change %.

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
- **Hover / Focus:** hover only on fine pointers (`fine-hover`). Focus is a 2px solid accent
  outline offset 2px (−2px inset on table rows). Every ring is declared as
  `focus-visible:outline-2 focus-visible:outline-solid`: in Tailwind 4, `outline-none`
  sets the outline style to none and `outline-2` alone doesn't restore it, which left 17
  controls with no visible focus. The search field is the exception: an
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
  headers: OPEN, HIGH, LOW, VOLUME. The Open tile carries the session's move since the open
  under its figure ("▲ +0.12% since open", Caption, signal tone), because the headline
  Change is from the previous close. A session figure the page doesn't have yet reads
  "—", never the current price standing in for it.
- **Not found:** an unknown ticker gets the detail panel's own glass, "No EGX instrument
  called “COMY”", the board's "Did you mean" suggestions as buttons, and an "All
  instruments" link (desktop only; phones have it in the row above the pane).
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
There is no nav chrome beyond the logo, which links home. A symbol's URL is scoped to its
market, `/EGX/symbols/COMI` (`pages/routes.ts`), so a second exchange can be added without
changing any existing link; the old `/symbols/COMI` form redirects. Rows open a symbol on click,
Enter or Space; on desktop the pane closes with its × or Esc. On a phone's detail view,
"← All instruments" and previous/next pills sit above the pane.

### Stream Badge (signature component)
The header's first pill, and the product's most important status. It shows the
server-assigned entitlement from `identity()`, never a client-side default:
- **LIVE:** Exchange Green tint and a 6px dot.
- **DELAYED · 15s:** Session Amber tint and a drawn clock. The label shows the delay
  honestly: the simulated offset marked "simulated", or "15 min" on a real gateway. The
  offset drops below 640px.

It renders nothing until the server has identified the stream. It is mounted on every
screen, so a delayed price is never mistaken for a live one. When the entitlement flips
mid-session, the pill plays one ring pulse in its own colour (900ms). Its word
scrambles from the old stream's to the new one's through random mono capitals (600ms,
`ScrambleWord`, already scrambled on the first painted frame, so an amber pill never
paints "LIVE"). The sign arrives too: the clock's hands sweep a full turn into
DELAYED, and the live dot pops in for LIVE. That is the only status change in the
product that asks for the eye. The scrambling word is `aria-hidden`; screen readers
hear only the new stream. The change is also announced through
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

The elapsed time drops below 640px so the header stays one row. Screen readers hear only the
state ("Connected", "Reconnecting, attempt 2") from a separate status region; the ticking
elapsed time and countdown are visual only.

Its big sibling, the connection banner, is a full-width glass pill that drops in (220ms,
from −6px) with a drawn icon, a title, a Slate detail line and an Ink action button. The
market banner uses the same pill. It says "Market closed", or "Pre-open auction" from
09:30 to 10:00 Cairo.

### Held state (stream down)
While the stream is reconnecting or closed, every price on screen is the last one received.
The prices keep full contrast, since they are what the user is judging, and are marked
where they sit:
- **HELD tag:** a mono label chip, amber at the fault strength of The Tinted Status Rule
  (16% tint, 32% border, Session Amber text).
- **Board:** the table card's edge turns amber (45% border plus a 20% 1px ring) and its
  caption leads with HELD and "since 12:31:05", the moment the stream stopped.
- **Detail:** the price panel takes the same edge, and its as-of line leads with HELD and
  ends "stream down, price not moving".
- **Banner:** the connection banner sticks under the header (75px), so a user scrolled
  deep into the board can still retry. In desktop split view it scrolls normally, since
  the pane sticks at that offset and carries its own HELD line.

### Refresh cadence
Everything that moves moves on one beat, every 10 seconds, aligned to the wall clock
(`display/pacedViews.ts`): row prices, the board's order when sorted, the hero cards'
picks and figures, the detail header, and (120ms later) the chart's live sample. They
land in the same commit, so a card's label, a sorted board's order and a row's figures
are one read and can never contradict each other: no "Top gainer" showing a fall, no
falling row on top of Gainers. A hero card only shows a symbol its label is true of
(nothing up means no Top gainer card). What a row or highlight card shows is the symbol's *paced*
view (`display/pacedViews.ts`), which only advances on the beat: a click, a sort or a
re-pick re-renders the board without painting any price early. The two exceptions: a
stream switch clears the old stream's figures at once, and opening a symbol lets that one
row catch up to the detail pane's fresh quote. While trading, a sorted board's caption
says it moves ("re-ranked every 10s"). Percentages everywhere go through one formatter
(`display/percent.ts`), so one move never reads −0.23% on the board and −0.24% beside it.

### Icons
Drawn SVG icons from `src/components/icons.tsx` (clock, retry, alert, search, arrow-left).
All sit on a 16px grid with a 1.6 stroke, use `currentColor` and are `aria-hidden`.
Unicode glyphs are never used as icons; ▲/▼ remain as direction text, not icons.

### Moments (earned, never on first paint, except the daily greeting)
Operate-mode delight lives at the moments that matter, not on routine clicks. Each one
says something true and useful, then gets out of the way:
- **Waiting:** the market-closed banner counts down to the bell, coarse on purpose
  ("in 1d 5h", "in 12m"), because it describes a wait rather than acting as a timer.
- **The opening bell:** if the page is open when EGX opens, an "EGX is open" banner
  appears with the candlestick mark (Exchange Green tint, auto-dismisses after 8s).
  It happens at most once a day. The mark forms the way a green candle does over a
  session (`FormingCandle`): the lower wick dips below the open, the body rallies up
  to the close, the upper wick tests the high, and the T's crossbar drops on with a
  small overshoot (about 1.1s). The candle stays green and ends on the logo's exact
  geometry.
- **The closing bell:** if EGX closes while the page is open, each hero card's label
  gains its session day ("TOP GAINER · THU") by scrambling in through mono capitals,
  the three cards 90ms apart, marking that the picks are now a recap. A page opened on
  a closed market just shows the day.
- **Recovery:** after a dropped stream reconnects, a "Reconnected" confirmation shows
  for 4s, so recovery is confirmed rather than inferred from a warning that vanished.
- **A search that finds nothing** suggests up to three closest instruments (edit
  distance on ticker and name words, ticker matches first) as "Did you mean" buttons
  that open the symbol. An unrelated query gets no suggestions.
- **Mastery:** a shortcut hint (↑ ↓ · Home End · Enter · ⌘K) appears under the table
  only while a row has keyboard focus, and never on touch.

Moment banners share the banner pill, with a 12% up tint and a quiet "Dismiss" text
button.

### The daily greeting (signature moment)
The one moment allowed on first paint: once per Cairo day, on whichever URL the day
starts, Tckr opens with "The Candle Prints" (`motion/Greeting.tsx`). It lasts about 3.5s.
- **The field:** a full-viewport overlay of the page's own Frost gradient and the same
  three glows (`FrostGlows`), dimmed as if the lights are still coming up. The glows
  bloom to full strength using opacity only, never scale, because scaling a 70px blur
  re-rasterises it every frame.
- **The candle:** at hero scale (96px wordmark, 60px on phones) the mark forms exactly as
  the opening bell's does: the low wick dips, the body rallies, the high wick pushes,
  and the crossbar lands. A mint light (`--tckr-blob-a`, a plain radial gradient with no
  filter) swells behind it through the rally and settles to an ember. "ckr" then
  resolves in mono.
- **The words:** a salutation for the hour in Cairo (Instrument Sans 500, Headline size)
  rises word by word through a mask, coming into focus. Beneath it the market's true
  state prints left to right in a tracked mono caption, beside a dot that is green only
  while EGX trades: "EGX is trading · closes 14:30 Cairo", "Pre-open auction · trading
  starts 10:00 Cairo", "EGX opens in 1h 12m", "EGX reopens Sun 10:00 Cairo". It never
  names the stream. LIVE/DELAYED is the server's to say, and it may not have said it
  yet.
- **The hand-off:** one continuous movement from its first frame, about 1.15s. The
  words lift away as the lockup sets off into the header logo's exact place (uniform
  scale, anchored on the mark, landing to the pixel) and becomes it. The flight uses
  `tckr-flight` (cubic-bezier(0.25, 0.1, 0.2, 1)): it is moving within 70ms and never
  surges. An in-out curve such as `expo.inOut` sat still for about half a second and
  then lurched, which read as lag. The field dissolves into the identical field
  beneath, so only the content appears, while the page's panes (`data-greet-rise`)
  settle up from 26px below. That rise is translation only: no scale, which would
  re-raster their text every frame, and no opacity, because opacity on a pane's
  ancestor changes what the glass blurs and the glass would snap when it returned.
  Everything that moves is promoted (`will-change`) for exactly the hand-off, so the
  field's three blurs are composited rather than repainted.
- **Never in the way:** any key, click, tap or scroll plays the rest of the introduction
  through in 0.45s and goes straight to the hand-off. It never cuts. The overlay is
  `aria-hidden`, passes pointer input through once the hand-off starts, and the page
  beneath stays live and accessible. If GSAP can't load, the overlay fades away on its
  own after 4.5s.
- **Reduced motion:** no flight and no movement. The finished lockup and the two lines
  appear, hold for 1.3s, and fade.
- **Once a day:** remembered per browser (`greetingSchedule.ts`). Where storage is
  unavailable it is skipped rather than replayed on every load. In development,
  `?greeting` replays it.

While the board loads, the same candle forms and un-forms in a loop beside "Loading
instruments…".

### Board re-rank motion (signature)
When the row order changes, each row that moved glides from its old rank to its new one.
That covers a preset or header sort, the per-beat re-rank of an active sort, and a search
narrowing the list. The glide is a FLIP (GSAP `Flip`), transform only, 420ms with the system ease. The
"before" positions are where rows are on screen at the moment the order changes, so a
re-rank that lands mid-glide (a sort click or a search keystroke) carries each row
on from where it actually is, rather than snapping it back first.
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
while typing in a field. From the search, Enter opens the ticker typed (or the first
match) and ↓ lands on the first row. The sortable headers are one Tab stop (the sorted
column, else Symbol) moved along with ←/→/Home/End. Arrowing through rows with a detail
open replaces the history entry, so Back closes the pane rather than replaying every row
passed. "Skip to instruments" is the first Tab stop on every page, ahead
of the logo, and lands on the board's current row. Focus is never dropped: if opening
hides the focused row (phones), it moves to the detail's heading; if closing removes it,
it returns to that symbol's row. While a row has keyboard focus, a glass legend floats at
the bottom of the viewport with the keys (Esc only when a detail is open); screen readers
get the same model as the table's description. In split view the collapsed hero cards are
`inert`, and opening a symbol is announced politely to screen readers.

### Price Cell (signature component)
Every displayed price or signed decimal goes through Price Cell. It is mono and tabular,
and a no-data state renders as a Slate "—" rather than a fake zero. A change lands on
the digits themselves; nothing is ever painted behind them:
- **Roll:** only the characters that changed move (`85.60 → 85.64` rolls the `4`). The new
  tail rises into place (drops, on a down move) over 420ms with a 2px blur, while the old
  one leaves the other way over 280ms (`RollingText`). The outgoing digits are a
  pseudo-element with empty alt text, so they never reach the text or the accessible name.
- **Light:** the figure starts in its signal colour and settles back to ink over 1.4s.
- **Arrow:** on the board, ▲/▼ fades in, holds, and fades out over 1.6s. The detail pane
  opts out of the glyph, because its change pills already carry the direction.
- **Wave:** every board row repaints on the same wall-clock beat, so each row's landing
  waits `--tckr-tick-delay` (9ms per row, capped at 260ms). The repaint travels down
  the board as one wave instead of landing in a single frame. The change-percent chips
  roll the same way (`TickingText`), and their tint eases over 600ms on the same delay.
- **Reduced motion:** no roll, no outgoing digits. The colour settle stays, so the
  change is still confirmed.
A landing survives re-renders that don't change the value (a row re-renders every second
for its clock). A change of symbol is never a change of value: the detail pane clears its
figures in the same render as the switch, so nothing flashes.

### Skeleton
While the detail pane waits for its snapshot and history, each part is drawn as its
own shape, where it will land and at its real size, so nothing moves when the data
arrives (`components/Skeleton.tsx`, `chart/ChartSkeleton.tsx`):
- **Price block:** a display-height slab for the price, two pill shapes for the change
  pills, and a caption-height bar for the as-of line.
- **Chart:** the chart's own frame at its own height. It has the hairline gridlines,
  price-axis label shapes on the right and time-axis label shapes along the bottom,
  placed from the live chart's axis sizes. It never draws a line, because a
  placeholder curve would be a price history that didn't happen.
- **Stat tiles:** the real tiles with their real labels (OPEN, HIGH, LOW, VOLUME), since
  those are known before any figure. Only each value is a shape. The same tiles stay
  when the quote lands, and only their values swap and stagger in.

The same skeleton covers the moment before the detail pane's code has even arrived
(a direct link to a symbol, or a click before the idle prefetch). It is the whole pane
(`DetailPaneSkeleton`, `App`'s Suspense fallback): the real symbol from the URL, with
every figure, the range pills, the close button and the chart as shapes. The controls
are shapes because they can't work yet. The pane never shows "Loading…" text.

A shape is Ink at 7% (14% under increased contrast). A band of light sweeps across it
every 1.6s in the glass-edge highlight (`--tckr-glass-border-card`), so it reads as
light crossing the pane rather than a grey slab. The sweep is transform-only and holds
still under reduced motion. Skeletons are `aria-hidden`, and each region also says
"Loading…" in screen-reader text. No digit ever appears in one.

### Sparkline (signature component)
A 20-point inline SVG polyline with a 1.6px stroke coloured by direction (green, red or
Slate when flat). It has no axis and no fill, is decorative only, and never renders a
number as text. It appears in the table's Session trend column (24px tall, 20 points) and in
hero cards (96 × 30px, 26 points). Both are seeded once from each symbol's session
history, downsampled, with the live price as the last point, so they show the session's
shape from first paint rather than starting flat.

### Price Chart
**Landing.** The chart samples on the page's wall-clock beat, 120ms after the header
repaints, so the price and the line arrive as one event. A new sample draws in over 720ms
(ease-out quart): the line's end travels from the previous sample to the new one while
both axes glide to the range that fits, and a point falling off a full window rides out
past the left edge. Only positions are in flight. The last-price tag and the readout
always print the real sample. A 7px dot in the line colour marks the line's live end, and
when the price has moved it rings once (1.1s) and nudges in the direction of the move.
Under reduced motion the sample lands in one frame with no ring.

**First view.** A symbol opens on SESSION ("how is today going"), and whichever range the
viewer picks is remembered (browser storage) for the next symbol and visit. Beside the
board the chart takes the height the viewport leaves under the price panel (340–600px);
stacked, it stays 340px.

A uPlot line drawn straight onto the detail panel's glass, clipped to a 16px radius (no
separate chart card): a 2.5px line (1.5px when the plot is under 480px wide, where a
session's samples would otherwise overlap into a band) over a 14% area fill, and 1px hairline
horizontal gridlines. A sparse Cairo-time axis runs along the bottom (`HH:MM` for
SESSION, `HH:MM:SS` for 60S/5M), always labelling both ends of the plotted span (10:00
and 14:30, even on a phone) with interior steps only where they fit, and a price axis sits on the right, both in 11px Plex
Mono in the muted token with no tick marks. Two tags hang off the plot onto the price
axis: the last plotted price, filled in the line colour, and on SESSION the previous close
(the baseline the page's change figures use), "Prev 85.10" on Paper Raised with a hairline
border ("Open" when a feed sends no previous close), marking a dashed muted line across the
plot. On the axis, never inside the plot, so the line can't run through them; when the two
would overlap, the reference tag steps one tag-height aside, and axis labels under a tag
are left blank; on a plot under 480px wide with both tags showing, the axis labels are
dropped altogether. The y range always includes the reference. The area under
the line is one 14% tint of the line's own colour, down to the frame, on every range. A quiet range is widened to at least 1% of the price, so a small wiggle never
fills the frame like a crash. The only corner chip names the slice of time plotted
(`pages/chartRanges.ts`): "Last 60s" / "Last 5m" / "Today since 10:00" while EGX trades;
once closed, the ranges end at the session's close and read as a recap ("Final 60s · Thu
24 Sep", "Thu 24 Sep session · 10:00–14:30"). The session high and low live in the stat
tiles.

Hovering the plot shows a crosshair and a readout chip that follows it above the line
(below it near the top edge): the sample's Cairo time in Slate and its price at tick-size
precision in Ink, on Paper with a hairline border and Card float.

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

**Hover (header only): the candle comes to life and trades.** Under a mouse, the T's
crossbar pops up and lands with an overshoot (a bell strike), "ckr" lifts with it, the body
rallies and the lower wick dips (about 0.4s). Then, for as long as the pointer stays, the
close moves to a new price level every ~0.45s: the body grows or shrinks from its open and
the upper wick stretches to meet the crossbar, so the T stays whole while it trades. Leaving
settles everything back to the resting mark in 0.22s, from wherever it is. The candle stays
green throughout. Mouse on a fine pointer only, never on keyboard focus, nothing under
reduced motion, and not while the daily greeting has the header logo hidden
(`motion/useLogoHover.ts`).

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
- **Do** build GSAP motion only in `src/motion` and reach GSAP only through
  `loadMotion()` / `useMotion()`. It is a lazily loaded chunk. A static `import 'gsap'`
  anywhere else pulls it into the entry bundle. Every GSAP moment is earned (never on
  first paint), renders its finished state underneath, and is skipped under reduced
  motion.
- **Do** animate layout changes with a view transition or transform and opacity. Start
  every view transition through `runViewTransition` (`components/viewTransition.ts`),
  scoped to the smallest element that changes; navigation uses
  `useViewTransitionNavigate`. Never transition `width`, `height`, `max-height` or margins.

### Don't:
- **Don't** tween a price's value: no count-ups, no scrambled figures, no GSAP tween on
  anything holding a `DecimalString`. Every in-between frame would be a price that
  never traded. Only positions, opacity, SVG geometry and labels move.
- **Don't** put glass over a flat opaque surface or strip the Frost field and glows from a
  desktop page (The Glass-Needs-A-Field Rule).
- **Don't** stack shadows or use them to express state. Card float and Table float are the
  only elevation shadows.
- **Don't** use a sharp (0px) corner or a border thicker than 1px.
- **Don't** colour the logo candle red or coral, or add "Market Watch" text to the lockup
  (The Always-Green Candle Rule).
- **Don't** colour the price chart's line per segment or per tick. It takes the session's
  direction as one colour (The Session-Direction Line Rule).
- **Don't** reintroduce the retired Night Terminal patterns: dark-only default, Roboto
  Mono/Archivo, the marquee ticker tape, or the permanent simulated-data banner.
