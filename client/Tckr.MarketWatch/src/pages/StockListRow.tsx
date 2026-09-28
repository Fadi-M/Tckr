/**
 * One board row, split out of `StockList.tsx`. A row subscribes to its own symbol, so a
 * tick re-renders only that row (GUIDELINES.md §5). "The module doc" in comments below
 * means `StockList.tsx`'s.
 */
import {
  useCallback,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { Link } from 'react-router-dom';
import { format, formatCompact } from '../contracts/decimal.ts';
import type { SymbolDefinition } from '../contracts/rest.ts';
import { symbolPath } from './routes.ts';
import { getPacedSymbolSnapshot, subscribePacedSymbol } from '../display/pacedViews.ts';
import { PriceCell } from '../components/PriceCell.tsx';
import { TickingText } from '../components/RollingText.tsx';
import { DELTA_TONE_CLASSES } from '../components/deltaTone.ts';
import { formatPercentFigure } from '../display/percent.ts';
import { toPlotValue } from '../chart/ringBuffer.ts';
import { sparklineDirection, useSessionSparkline } from './useBoundedSparkline.ts';
import type { ColumnKey } from './boardColumns.tsx';
import {
  tradedValue,
  isEffectivelyUnchanged,
  formatSignedPercent,
  percentTone,
  ZERO_DECIMAL,
  tickDelay,
} from './boardColumns.tsx';
import { Sparkline } from './HeroCards.tsx';

// Shared `<th>`/`<td>` base — previously the tag-selector `.tckr-stocklist__table
// th, .tckr-stocklist__table td { ... }`, which applied automatically without a
// class; Tailwind utilities need an explicit class on every cell instead. Excludes
// `text-align` on purpose — every cell chooses `text-left` or `text-right` for
// itself (see call sites) rather than this constant asserting one and a numeric
// cell overriding it, which would be two same-specificity utility classes fighting
// over the same property.
// 40px rows (8px + 24px line + 8px) on a mouse — a trading board is read by scanning
// many rows at once — and 44px on touch, the minimum comfortable tap target.
export const CELL_BASE =
  'px-3 py-2 pointer-coarse:py-2.5 border-b border-glass-border overflow-hidden text-ellipsis whitespace-nowrap';

interface StockListRowProps {
  readonly definition: SymbolDefinition;
  /** The row's position on the board, which staggers its repaint (see `tickDelay`). */
  readonly boardIndex?: number;
  readonly priceDecimals: number;
  /** The board's widest price precision, so every row's decimal point lines up (see
   * `PriceCell`'s `alignDecimals`). */
  readonly alignDecimals?: number;
  readonly onActivate: (symbol: string) => void;
  /** Whether this row's symbol is the one currently open in the split-pane detail
   * view (see `useMatch(SYMBOL_ROUTE_PATTERN)` in `StockList`). Purely presentational
   * (a glass highlight + accent edge) — never affects subscription lifecycle. */
  readonly selected?: boolean;
  /** The columns this row renders a cell for — `visibleColumns(...)` in `StockList`,
   * the same list its header and `<colgroup>` use. Left-out columns' `<td>`s are
   * omitted from the DOM entirely, not hidden: `table-layout: fixed`'s per-column
   * width comes from each column's `<col>` percentage, and Chromium (verified against
   * this exact table) miscomputes it when a visible column's `<col>` sits *after* a
   * `display: none`-hidden one in the same `<colgroup>`, collapsing it to ~0 width. */
  readonly columns: ReadonlySet<ColumnKey>;
  /** Roving tabindex: exactly one row in the table is a Tab stop (`tabIndex=0`); the
   * rest are `-1` and reached with the arrow keys (see `handleTableKeyDown` in
   * `StockList`). Keeps the whole 34-row table to one Tab stop, so a keyboard user can
   * reach the detail pane beside it without tabbing through every row. */
  readonly tabStop?: boolean;
  readonly onRowFocus?: (symbol: string) => void;
  /** The symbol's full session price history (plot values), for `useSessionSparkline`;
   * `undefined` until `StockList`'s one-time history fetch resolves. */
  readonly sessionTrend?: readonly number[] | undefined;
}

export function StockListRow({
  definition,
  priceDecimals,
  alignDecimals,
  onActivate,
  selected = false,
  columns,
  tabStop = true,
  onRowFocus,
  sessionTrend,
  boardIndex = 0,
}: StockListRowProps) {
  const { symbol, name, referencePrice } = definition;

  // A hot symbol can tick dozens of times/sec even after `TickDispatcher`'s per-frame
  // coalescing (that cap is a data-correctness contract, not a readability one — see
  // `src/display/throttle.ts`). This row shows its symbol's paced view
  // (`src/display/pacedViews.ts`), which advances at most once per
  // `DISPLAY_REFRESH_INTERVAL_MS` on wall-clock-aligned slots, so the selected row and
  // `StockDetail`'s header flush the same burst on the same beat. Pacing the view, not
  // just the notification, is what keeps a re-render from elsewhere (a click, a sort)
  // from painting prices early.
  // Paced, not live: a render between beats (a click, a sort) shows what the last beat
  // painted — see `src/display/pacedViews.ts`.
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribePacedSymbol(symbol, onStoreChange),
    [symbol],
  );
  const view = useSyncExternalStore(subscribe, () => getPacedSymbolSnapshot(symbol));

  // Test-support only: a per-row render counter surfaced as a data attribute so
  // `StockList.render-isolation.test.tsx` can assert exactly one extra render for the
  // ticked row and zero for every other row. Never read by production code or styling.
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  const priceMuted = view === undefined;
  const price = view?.price ?? referencePrice;
  const change = view?.change ?? ZERO_DECIMAL;
  const changePercent = view?.changePercent;
  const volumeLabel = view ? view.volume.toLocaleString('en-US') : '—';
  const valueLabel = view
    ? formatCompact(tradedValue(definition, view), { fixedFraction: true })
    : '—';

  // Decorative sparkline history — bounded, committed post-render (see module doc for
  // why this mirrors PriceCell's flash-tracking shape rather than mutating during
  // render). Never read as text anywhere; text prices always go through PriceCell.
  // `toPlotValue` (`src/chart/ringBuffer.ts`) is the one sanctioned `DecimalString` ->
  // `number` conversion for exactly this "plotting/decoration, never re-displayed as
  // text" purpose — reused here rather than a second, duplicate inline conversion.
  // Shared ref/effect/read-back triplet lives in `useBoundedSparkline.ts`; this row
  // keeps its own 20-point cap (`HeroCard`'s is 26).
  // Seeded from the session history once it loads — see `useSessionSparkline`.
  const currentPriceNum = toPlotValue(price);
  const sparklinePoints = useSessionSparkline(currentPriceNum, 20, sessionTrend);
  const direction = sparklineDirection(changePercent);

  // A sighted user reads price and up/down direction straight off the row (that's the
  // entire point of it); `aria-label={symbol}` alone gives a keyboard/screen-reader
  // user — the row is the focus target (`tabIndex` below) — none of that. Build a
  // richer label from data already computed above rather than a new formatting
  // dependency: `price` is already a plain decimal string, so `String(price)` is a
  // type-safe pass-through, not a numeric reformat. Recomputed on every render (cheap,
  // plain string concatenation) — deliberately *not* wired to `aria-live`: constant
  // per-tick announcements across 34 independently-ticking rows would spam a screen
  // reader, so this only changes what is read when the row is *visited*, not when it
  // changes.
  const directionWord =
    direction === 'flat' || (changePercent !== undefined && isEffectivelyUnchanged(changePercent))
      ? 'unchanged'
      : direction;
  const baseAriaLabel =
    changePercent === undefined
      ? `${symbol}, ${String(price)}`
      : `${symbol}, ${String(price)}, ${directionWord} ${formatPercentFigure(changePercent, { magnitude: true })}%`;
  // The header's StreamBadge says which stream the whole board is on; a row visited in
  // isolation by a screen reader repeats it, so a delayed price is never read as live.
  // Change amount and volume follow once a tick or snapshot has arrived — the same
  // figures the Change and Volume columns show, which a narrow row doesn't render at all.
  const detailAriaLabel = view
    ? `${baseAriaLabel}, change ${format(change, { decimals: priceDecimals, sign: true })}, volume ${volumeLabel}`
    : baseAriaLabel;
  const rowAriaLabel =
    view?.stream === 'DELAYED' ? `${detailAriaLabel}, delayed stream` : detailAriaLabel;

  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate(symbol);
    }
  };

  const changeDeltaClass = DELTA_TONE_CLASSES[percentTone(changePercent)];

  return (
    <tr
      // `fine-hover:` compiles to a `:hover`-suffixed class, which (like the plain
      // CSS this replaces) has higher specificity than the plain `bg-[...]` class
      // `selected` adds below, so hovering a selected row still shows the ordinary
      // hover tint instead of the selected highlight — matching the original
      // `.tckr-stocklist__row:hover` (two compound selectors) outranking
      // `.tckr-stocklist__row--selected` (one class) under real CSS specificity
      // rules. That relationship survives here because Tailwind gives a pseudo-class
      // variant genuinely higher specificity, not just later source order.
      className={`cursor-pointer [transition:background-color_120ms_ease,box-shadow_120ms_ease] fine-hover:bg-[color-mix(in_oklab,var(--tckr-color-text)_6%,transparent)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent focus-visible:-outline-offset-2${
        selected
          ? ' bg-[color-mix(in_oklab,var(--tckr-color-up)_12%,transparent)] shadow-[inset_3px_0_0_var(--tckr-color-up)]'
          : ''
      }`}
      tabIndex={tabStop ? 0 : -1}
      aria-label={rowAriaLabel}
      aria-selected={selected}
      style={{ '--tckr-tick-delay': tickDelay(boardIndex) } as CSSProperties}
      data-symbol={symbol}
      data-render-count={renderCountRef.current}
      onClick={() => onActivate(symbol)}
      onKeyDown={handleKeyDown}
      onFocus={onRowFocus ? () => onRowFocus(symbol) : undefined}
    >
      <td className={`${CELL_BASE} text-left font-mono font-semibold`}>
        {/* The row is the keyboard target (one Tab stop for the board), but a <tr> has
            no role that says it opens anything. This link gives screen-reader users a
            real, discoverable action (links list, "open in new tab") without adding a
            Tab stop. A plain click falls through to the row's own handler, which also
            closes an already-open symbol; a modified click keeps the browser default. */}
        <Link
          to={symbolPath(symbol)}
          tabIndex={-1}
          className="text-inherit no-underline"
          aria-label={`Open ${symbol} details`}
          onClick={(event) => {
            if (
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey ||
              event.button !== 0
            ) {
              event.stopPropagation();
              return;
            }
            event.preventDefault();
          }}
        >
          {symbol}
        </Link>
      </td>
      {columns.has('trend') ? (
        <td className={`${CELL_BASE} text-left max-[640px]:hidden`}>
          <Sparkline points={sparklinePoints} direction={direction} />
        </td>
      ) : null}
      {columns.has('name') ? (
        <td className={`${CELL_BASE} text-left max-[640px]:hidden`}>{name}</td>
      ) : null}
      <td className={`${CELL_BASE} text-right tabular-nums`}>
        <PriceCell
          value={price}
          decimals={priceDecimals}
          alignDecimals={alignDecimals}
          muted={priceMuted}
          flashDirectionOverride={
            changePercent === undefined
              ? undefined
              : changePercent > 0
                ? 'up'
                : changePercent < 0
                  ? 'down'
                  : null
          }
        />
      </td>
      {columns.has('change') ? (
        <td className={`${CELL_BASE} text-right tabular-nums max-[640px]:hidden`}>
          <PriceCell
            value={change}
            decimals={priceDecimals}
            alignDecimals={alignDecimals}
            sign
            muted={priceMuted}
            indicateSign
          />
        </td>
      ) : null}
      <td className={`${CELL_BASE} text-right tabular-nums`}>
        {changePercent === undefined ? (
          <span className="font-mono tabular-nums text-text-muted">—</span>
        ) : (
          <span
            className={`font-mono tabular-nums inline-block align-middle px-2 py-0.5 leading-5 rounded-[5px] [transition:background-color_600ms_var(--tckr-ease-out),color_600ms_var(--tckr-ease-out)] [transition-delay:var(--tckr-tick-delay,0ms)] ${changeDeltaClass}`}
          >
            <TickingText
              text={formatSignedPercent(changePercent)}
              direction={changePercent < 0 ? 'down' : 'up'}
            />
          </span>
        )}
      </td>
      {columns.has('volume') ? (
        <td className={`${CELL_BASE} text-right font-mono tabular-nums max-[640px]:hidden`}>
          {volumeLabel}
        </td>
      ) : null}
      {columns.has('value') ? (
        <td className={`${CELL_BASE} text-right font-mono tabular-nums max-[640px]:hidden`}>
          {valueLabel}
        </td>
      ) : null}
    </tr>
  );
}
