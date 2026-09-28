/**
 * Layout class fragments and the keyboard-help popover for the board page, split out of
 * `StockList.tsx`.
 */
import { modifierKeyLabel } from '../components/keyboard.ts';

// ---------------------------------------------------------------------------------
// Shared class fragments for `StockList`'s own return (below) — kept as named
// constants/helpers, in the same spirit as `CONN_BANNER_*` above, rather than
// inlined into the JSX twice (the loading branch and the loaded branch both render
// the split shell). Where a modifier flips a property the base value also sets
// (width, opacity/transform, max-height/margin — previously
// `.tckr-stocklist__shell--split .tckr-stocklist__list-col` etc., a parent-state ->
// child-class selector with no Tailwind utility-class equivalent), the helper
// returns one full mutually-exclusive class string per state rather than a base
// string plus a conditionally-appended override, so there is never a pair of
// same-specificity utility classes whose winner depends on Tailwind's internal
// ordering.
// ---------------------------------------------------------------------------------

// Split-pane layout. None of these animate a layout property: opening or closing a
// symbol switches the layout in a single step, and the motion comes from a view
// transition (`useViewTransitionNavigate`) that animates snapshots of the named regions
// below on the compositor — see the `::view-transition-*` rules in tailwind.css.
// Earlier versions transitioned `width`, `max-height` and `margin-bottom` here, which
// re-ran layout for the whole page, 34-row table included, on every frame.
//
// The detail pane is `hidden` (not merely zero-width) while closed, so it neither
// takes a flex gap nor leaves the table card short of the search row's right edge.

export const SHELL_CLASS = 'flex items-start gap-4 max-[800px]:flex-col max-[800px]:items-stretch';

export function shellListColClass(split: boolean): string {
  return `min-w-0 [view-transition-name:tckr-list] ${split ? 'flex-none w-[380px] max-[800px]:hidden' : 'w-full'}`;
}

// Beside the list, the detail pane sticks just under the sticky app header (59px + a
// 16px gap), so scrolling a 34-row board never scrolls the open chart away. Only where
// the viewport is tall enough to hold the whole pane (≈615px) under the header;
// shorter windows keep normal flow so the stat tiles are never cut off.
const DETAIL_PANE_STICKY =
  '[@media(min-width:801px)_and_(min-height:720px)]:sticky [@media(min-width:801px)_and_(min-height:720px)]:top-[75px]';

export function shellDetailPaneClass(split: boolean): string {
  return `flex-1 min-w-0 max-[800px]:w-full [view-transition-name:tckr-detail] ${split ? DETAIL_PANE_STICKY : 'hidden'}`;
}

// `hidden` (display: none) while split: the cards leave the layout, the Tab order and
// the accessibility tree at once, and the view transition fades their snapshot out.
export function heroWrapClass(split: boolean): string {
  return split ? 'hidden' : 'mb-3.5 [view-transition-name:tckr-hero]';
}

export const PILL_BASE =
  'text-caption px-3 py-[7px] rounded-full border cursor-pointer [transition:background-color_150ms_ease,color_150ms_ease,border-color_150ms_ease,transform_120ms_ease-out] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent focus-visible:outline-offset-2';
export const PILL_ACTIVE = 'bg-text text-surface border-text font-semibold';
export const PILL_INACTIVE = 'bg-transparent text-text-muted border-border font-medium';

export const SEARCH_WRAP_CLASS =
  'flex-[1_1_240px] min-w-[160px] flex items-center gap-2 py-2.5 px-3.5 border border-glass-border rounded-full bg-glass backdrop-blur-tckr backdrop-saturate-150 [transition:border-color_150ms_ease] focus-within:border-[var(--tckr-field-focus-border)] focus-within:outline-[3px] focus-within:outline-[var(--tckr-field-focus-halo)] focus-within:outline-offset-0 reduced-transparency:bg-surface reduced-transparency:backdrop-blur-none reduced-transparency:backdrop-saturate-100 contrast-more:bg-surface contrast-more:backdrop-blur-none contrast-more:backdrop-saturate-100';

export function tableWrapClass(stale: boolean): string {
  const base =
    'w-full max-w-full border border-glass-border rounded-[18px] overflow-hidden bg-glass backdrop-blur-tckr backdrop-saturate-[1.6] shadow-float [transition:border-color_250ms_ease,outline-color_250ms_ease] reduced-transparency:bg-surface reduced-transparency:backdrop-blur-none reduced-transparency:backdrop-saturate-100 contrast-more:bg-surface contrast-more:backdrop-blur-none contrast-more:backdrop-saturate-100';
  // Held prices keep full contrast (they are exactly what the user is judging); the
  // card's edge turns amber and the caption says since when, instead of dimming them.
  return stale
    ? `${base} border-[color-mix(in_oklab,var(--tckr-color-warning)_45%,transparent)]! outline outline-offset-0 outline-[color-mix(in_oklab,var(--tckr-color-warning)_20%,transparent)]`
    : base;
}

export const SORT_BUTTON_CLASS =
  'appearance-none bg-transparent border-none m-0 p-0 outline-none text-inherit [text-transform:inherit] cursor-pointer font-semibold inline-flex items-center gap-0.5 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent focus-visible:outline-offset-2';

const KBD_CLASS =
  'font-mono text-label border border-border rounded px-1.5 py-px bg-surface-raised';

export const BOARD_HELP_ID = 'tckr-board-help';

/**
 * The board's keyboard model, said once for each audience. Screen readers get it as
 * the table's description (`aria-describedby`). Sighted keyboard users get a legend
 * that floats at the bottom of the viewport while a row has keyboard focus, so it is
 * in view wherever in the 34 rows they are, and never clutters the board for anyone
 * else. Hidden on touch devices, where none of these keys exist.
 */
export function BoardKeyboardHelp({ detailOpen }: { detailOpen: boolean }) {
  const mod = modifierKeyLabel();
  return (
    <>
      <p id={BOARD_HELP_ID} className="sr-only">
        Arrow keys move between instruments, Home and End jump to the first and last, Enter opens
        one
        {detailOpen ? ', and the open details follow the arrow keys; Escape closes them' : ''}.
        Press {mod}K or slash to search.
      </p>
      <p
        className="hidden group-has-[tr:focus-visible]/board:flex pointer-coarse:!hidden fixed bottom-4 left-1/2 -translate-x-1/2 z-10 items-center flex-wrap justify-center gap-x-3.5 gap-y-1 px-4 py-2 rounded-full bg-glass-strong border border-glass-border backdrop-blur-tckr shadow-[0_12px_30px_-16px_rgba(20,24,31,0.45)] text-caption text-text-muted whitespace-nowrap reduced-transparency:bg-surface contrast-more:bg-surface"
        aria-hidden="true"
      >
        <span>
          <kbd className={KBD_CLASS}>↑</kbd> <kbd className={KBD_CLASS}>↓</kbd> move
        </span>
        <span>
          <kbd className={KBD_CLASS}>Home</kbd> <kbd className={KBD_CLASS}>End</kbd> jump
        </span>
        <span>
          <kbd className={KBD_CLASS}>Enter</kbd> open
        </span>
        {detailOpen ? (
          <span>
            <kbd className={KBD_CLASS}>Esc</kbd> close
          </span>
        ) : null}
        <span>
          <kbd className={KBD_CLASS}>{mod}K</kbd> or <kbd className={KBD_CLASS}>/</kbd> search
        </span>
      </p>
    </>
  );
}

export const EMPTY_ACTION_BUTTON_BASE =
  'font-semibold text-caption px-3.5 py-[9px] rounded-[7px] cursor-pointer [transition:transform_120ms_ease-out,opacity_150ms_ease] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent focus-visible:outline-offset-2';
