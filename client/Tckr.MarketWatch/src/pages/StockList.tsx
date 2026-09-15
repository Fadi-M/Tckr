/**
 * StockList — task 04 (docs/phase-3-web-client/04-stock-list.md), route `/`.
 *
 * Renders the 34-instrument universe as a searchable, sortable table where a tick for
 * one symbol re-renders that row and nothing else (README.md design decision #9). The
 * page itself never subscribes to price data — it owns the symbol list (from
 * `getUniverse()`), the search text and the sort state; each `StockListRow` below
 * subscribes to its own symbol via `useSyncExternalStore`.
 *
 * Sorting by a live column (Price/Change/Change %/Volume/Last update) reads the store
 * *imperatively* through `getSymbolSnapshot` at render time — never reactively. That is
 * deliberate: resorting on every tick would reintroduce the whole-table re-render this
 * page exists to avoid, and would also make rows jump around under a user's cursor. The
 * displayed order is therefore a snapshot taken when the page itself re-renders (mount,
 * a debounced search, or a sort click) — see "Notes for other tasks".
 *
 * ---------------------------------------------------------------------------------
 * "Tckr First Run" design pass additions (docs/decisions — design import)
 * ---------------------------------------------------------------------------------
 * Three presentational/decorative additions live in this file rather than in
 * `App.tsx`/`SimulatedBanner.tsx`, because those two files are contractually
 * data-source-agnostic (`shell.no-data-import.test.ts`) and this page already owns the
 * `/` route and imports `src/data/**`:
 *
 *  - A ticker tape marquee (`TickerTape`) — decorative, refreshed on a 1s interval via
 *    an imperative `getSymbolSnapshot` read (same "don't re-render on every tick"
 *    discipline as the sort columns above), never a per-tick subscription.
 *  - A connection-state banner (`useConnectionBanner`) — an independent observer of the
 *    shared `MarketDataSource`, exactly like `ConnectionStatus`/`StreamBadge` already
 *    are (multiple independent subscribers to the same singleton is an established
 *    pattern, not a new one). Its "Retry now"/"Reconnect" buttons call
 *    `source.connect()` directly — a one-off user action, distinct from the automatic
 *    backoff loop `ConnectionStatus`'s doc comment says a *display* component must
 *    never drive itself.
 *  - Per-row sparklines — a small bounded (20-point) price history kept in a ref on
 *    each `StockListRow`, persisted in a `useEffect` (same "commit after render, guard
 *    on the value actually changing" shape `PriceCell` already uses for its flash
 *    animation, so it stays StrictMode-safe) and rendered as a tiny inline SVG. Purely
 *    decorative: every price a user can read as *text* still goes through `PriceCell`/
 *    `format()` — the sparkline's own numeric conversion never reaches the page as
 *    text, only as pixel geometry (the same boundary `chart/ringBuffer.ts` draws for
 *    the detail page's chart).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { compare, toDecimal, type DecimalString } from '../contracts/decimal.ts';
import type { SymbolDefinition } from '../contracts/rest.ts';
import { CloseCode } from '../contracts/closeCodes.ts';
import { getSharedSource } from '../data/config.ts';
import type { ConnectionState } from '../data/MarketDataSource.ts';
import { getSymbolSnapshot, subscribeSymbol } from '../data/store.ts';
import { PriceCell } from '../components/PriceCell.tsx';
import { DISPLAY_REFRESH_INTERVAL_MS } from '../display/throttle.ts';

const ZERO_DECIMAL: DecimalString = toDecimal('0');

type SortColumn = 'symbol' | 'name' | 'price' | 'change' | 'changePercent' | 'volume' | 'lastUpdate';
type SortDirection = 'asc' | 'desc';

interface SortState {
  readonly column: SortColumn;
  readonly direction: SortDirection;
}

interface ColumnSpec {
  readonly key: SortColumn | 'trend';
  readonly label: string;
  readonly sortable: boolean;
  /** Hidden below the 640px breakpoint (task 03's convention) so the page stays
   * scroll-free at 400px — only Symbol, Price and Change % remain. */
  readonly hideNarrow?: boolean;
}

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'symbol', label: 'Symbol', sortable: true },
  { key: 'trend', label: 'Last 60s', sortable: false, hideNarrow: true },
  { key: 'name', label: 'Name', sortable: true, hideNarrow: true },
  { key: 'price', label: 'Price', sortable: true },
  { key: 'change', label: 'Change', sortable: true, hideNarrow: true },
  { key: 'changePercent', label: 'Change %', sortable: true },
  { key: 'volume', label: 'Volume', sortable: true, hideNarrow: true },
  { key: 'lastUpdate', label: 'Last update', sortable: true, hideNarrow: true },
];

type Preset = 'most-active' | 'gainers' | 'losers' | 'az';

const PRESETS: readonly { readonly id: Preset; readonly label: string; readonly sort: SortState }[] = [
  { id: 'most-active', label: 'Most active', sort: { column: 'volume', direction: 'desc' } },
  { id: 'gainers', label: 'Gainers', sort: { column: 'changePercent', direction: 'desc' } },
  { id: 'losers', label: 'Losers', sort: { column: 'changePercent', direction: 'asc' } },
  { id: 'az', label: 'A–Z', sort: { column: 'symbol', direction: 'asc' } },
];

function presetFor(sortState: SortState | null): Preset | null {
  if (!sortState) {
    return null;
  }
  const match = PRESETS.find(
    (preset) => preset.sort.column === sortState.column && preset.sort.direction === sortState.direction,
  );
  return match?.id ?? null;
}

function decimalPlacesOf(value: string): number {
  const dot = value.indexOf('.');
  return dot === -1 ? 0 : value.length - dot - 1;
}

function compareBy(column: SortColumn, a: SymbolDefinition, b: SymbolDefinition): number {
  switch (column) {
    case 'symbol':
      return a.symbol.localeCompare(b.symbol);
    case 'name':
      return a.name.localeCompare(b.name);
    case 'price': {
      const pa = getSymbolSnapshot(a.symbol)?.price ?? a.referencePrice;
      const pb = getSymbolSnapshot(b.symbol)?.price ?? b.referencePrice;
      return compare(pa, pb);
    }
    case 'change': {
      const ca = getSymbolSnapshot(a.symbol)?.change ?? ZERO_DECIMAL;
      const cb = getSymbolSnapshot(b.symbol)?.change ?? ZERO_DECIMAL;
      return compare(ca, cb);
    }
    case 'changePercent': {
      const pa = getSymbolSnapshot(a.symbol)?.changePercent ?? 0;
      const pb = getSymbolSnapshot(b.symbol)?.changePercent ?? 0;
      return pa - pb;
    }
    case 'volume': {
      const va = getSymbolSnapshot(a.symbol)?.volume ?? 0;
      const vb = getSymbolSnapshot(b.symbol)?.volume ?? 0;
      return va - vb;
    }
    case 'lastUpdate': {
      const la = getSymbolSnapshot(a.symbol)?.lastUpdate ?? 0;
      const lb = getSymbolSnapshot(b.symbol)?.lastUpdate ?? 0;
      return la - lb;
    }
    default:
      return 0;
  }
}

function formatSignedPercent(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function formatRelativeTime(lastUpdate: number, now: number): string {
  const deltaSeconds = Math.max(0, Math.floor((now - lastUpdate) / 1000));
  if (deltaSeconds < 1) {
    return 'just now';
  }
  if (deltaSeconds < 60) {
    return `${deltaSeconds}s ago`;
  }
  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// ---------------------------------------------------------------------------------
// Connection banner — independent observer of the shared MarketDataSource, mirroring
// (not sharing state with) ConnectionStatus/StreamBadge. See module doc.
// ---------------------------------------------------------------------------------

function seedConnectionState(): ConnectionState {
  const source = getSharedSource();
  const current = source.connectionState?.();
  if (current) {
    return current;
  }
  return source.identity() !== null ? { kind: 'connected', since: Date.now() } : { kind: 'connecting', attempt: 1 };
}

function useConnectionBanner(): { state: ConnectionState; remainingSecs: number } {
  const [state, setState] = useState<ConnectionState>(seedConnectionState);
  const [eventReceivedAt, setEventReceivedAt] = useState<number>(() => Date.now());
  const [, forceTick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const source = getSharedSource();
    return source.on.status((next) => {
      setEventReceivedAt(Date.now());
      setState(next);
    });
  }, []);

  useEffect(() => {
    if (state.kind !== 'reconnecting') {
      return;
    }
    const id = setInterval(() => forceTick(), 1000);
    return () => clearInterval(id);
  }, [state.kind]);

  const remainingSecs =
    state.kind === 'reconnecting'
      ? Math.max(0, Math.ceil((state.nextRetryMs - (Date.now() - eventReceivedAt)) / 1000))
      : 0;

  return { state, remainingSecs };
}

function closeDetail(code: CloseCode): string {
  switch (code) {
    case CloseCode.Normal:
      return 'The stream closed and will not retry on its own.';
    case CloseCode.Unauthenticated:
      return 'Not authenticated. Sign in again, then reconnect.';
    case CloseCode.TokenExpired:
      return 'Your session expired.';
    case CloseCode.HeartbeatTimeout:
      return 'The connection timed out.';
    case CloseCode.SlowConsumer:
      return 'This client fell behind and was disconnected. Try watching fewer symbols.';
  }
}

function ConnectionBanner({ state, remainingSecs }: { state: ConnectionState; remainingSecs: number }) {
  if (state.kind === 'reconnecting') {
    return (
      <div className="tckr-conn-banner tckr-conn-banner--warning" role="alert">
        <span className="tckr-conn-banner__icon" aria-hidden="true">
          ◴
        </span>
        <div className="tckr-conn-banner__body">
          <div className="tckr-conn-banner__title">The stream dropped — retrying in {remainingSecs}s</div>
          <div className="tckr-conn-banner__detail">
            Attempt {state.attempt}. Prices below are the last values received and are no longer moving.
          </div>
        </div>
        <button
          type="button"
          className="tckr-conn-banner__action"
          onClick={() => {
            void getSharedSource().connect();
          }}
        >
          Retry now
        </button>
      </div>
    );
  }

  if (state.kind === 'closed') {
    return (
      <div className="tckr-conn-banner tckr-conn-banner--danger" role="alert">
        <span className="tckr-conn-banner__icon" aria-hidden="true">
          ⚠
        </span>
        <div className="tckr-conn-banner__body">
          <div className="tckr-conn-banner__title">Disconnected</div>
          <div className="tckr-conn-banner__detail">{closeDetail(state.code)}</div>
        </div>
        <button
          type="button"
          className="tckr-conn-banner__action"
          onClick={() => {
            void getSharedSource().connect();
          }}
        >
          Reconnect
        </button>
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------------
// Ticker tape — decorative marquee, refreshed on an interval, never a per-tick
// subscription (see module doc).
// ---------------------------------------------------------------------------------

interface TapeItem {
  readonly symbol: string;
  readonly price: DecimalString;
  readonly changePercent: number | undefined;
}

function readTapeItems(universe: readonly SymbolDefinition[]): readonly TapeItem[] {
  return universe.map((def) => {
    const view = getSymbolSnapshot(def.symbol);
    return {
      symbol: def.symbol,
      price: view?.price ?? def.referencePrice,
      changePercent: view?.changePercent,
    };
  });
}

function TickerTape({ universe, held }: { universe: readonly SymbolDefinition[]; held: boolean }) {
  const [items, setItems] = useState<readonly TapeItem[]>(() => readTapeItems(universe));

  useEffect(() => {
    setItems(readTapeItems(universe));
    const id = setInterval(() => setItems(readTapeItems(universe)), DISPLAY_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [universe]);

  if (items.length === 0) {
    return null;
  }

  const track = [...items, ...items];

  return (
    <div className={`tckr-tape${held ? ' tckr-tape--held' : ''}`} aria-hidden="true">
      <div className="tckr-tape__track">
        {track.map((item, index) => (
          <span key={`${item.symbol}-${index}`} className="tckr-tape__item">
            {item.symbol}{' '}
            <span className="tckr-tape__price">
              <PriceCell
                value={item.price}
                muted={held}
                flashDirectionOverride={
                  item.changePercent === undefined
                    ? undefined
                    : item.changePercent > 0
                      ? 'up'
                      : item.changePercent < 0
                        ? 'down'
                        : null
                }
              />
            </span>{' '}
            <span
              className={
                item.changePercent === undefined
                  ? 'tckr-tape__delta'
                  : `tckr-tape__delta ${item.changePercent > 0 ? 'tckr-delta--up' : item.changePercent < 0 ? 'tckr-delta--down' : ''}`
              }
            >
              {item.changePercent === undefined ? '0.00%' : `${formatSignedPercent(item.changePercent)}`}
            </span>
          </span>
        ))}
      </div>
      {held ? <div className="tckr-tape__held-label">TAPE HELD</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------
// Sparkline — decorative only. See module doc for the "text vs. pixel geometry"
// boundary this keeps.
// ---------------------------------------------------------------------------------

function Sparkline({ points, direction }: { points: readonly number[]; direction: 'up' | 'down' | 'flat' }) {
  const lineClass = `tckr-sparkline__line tckr-sparkline__line--${direction}`;
  if (points.length < 2) {
    return (
      <svg viewBox="0 0 100 34" preserveAspectRatio="none" className="tckr-sparkline">
        <line x1="0" y1="17" x2="100" y2="17" className={lineClass} />
      </svg>
    );
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = 100 / (points.length - 1);
  const coords = points
    .map((p, i) => `${(i * step).toFixed(2)},${(30 - ((p - min) / span) * 28).toFixed(2)}`)
    .join(' ');
  return (
    <svg viewBox="0 0 100 34" preserveAspectRatio="none" className="tckr-sparkline">
      <polyline points={coords} fill="none" className={lineClass} />
    </svg>
  );
}

const STOCK_LIST_STYLES = `
.tckr-stocklist { width: 100%; max-width: 100%; }

.tckr-tape {
  overflow: hidden;
  background: var(--tckr-color-surface);
  border: 1px solid var(--tckr-color-border);
  border-radius: 10px;
  padding: 9px 0;
  margin-bottom: 14px;
  position: relative;
  -webkit-mask-image: linear-gradient(90deg, transparent, black 32px, black calc(100% - 32px), transparent);
  mask-image: linear-gradient(90deg, transparent, black 32px, black calc(100% - 32px), transparent);
}
.tckr-tape__track {
  display: flex;
  gap: 26px;
  width: max-content;
  white-space: nowrap;
  animation: tckr-tape-scroll 32s linear infinite;
  transition: opacity 250ms ease, filter 250ms ease;
}
.tckr-tape--held .tckr-tape__track { opacity: 0.32; filter: saturate(0.3); animation-play-state: paused; }
.tckr-tape__held-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--tckr-font-mono);
  font-size: 0.6rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: var(--tckr-color-warning);
  background: linear-gradient(90deg, color-mix(in oklab, var(--tckr-color-surface) 88%, transparent), transparent, color-mix(in oklab, var(--tckr-color-surface) 88%, transparent));
  animation: tckr-fade-in 200ms ease-out;
}
@keyframes tckr-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
.tckr-tape__item { font-family: var(--tckr-font-mono); font-size: 0.72rem; color: var(--tckr-color-text-muted); }
.tckr-tape__price { color: var(--tckr-color-text); }
.tckr-tape__delta { font-variant-numeric: tabular-nums; }
@keyframes tckr-tape-scroll {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}

.tckr-conn-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 9px;
  margin-bottom: 14px;
  animation: tckr-banner-in 220ms cubic-bezier(0.23, 1, 0.32, 1);
}
@keyframes tckr-banner-in {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
}
.tckr-conn-banner--warning {
  background: color-mix(in oklab, var(--tckr-color-warning) 9%, transparent);
  border: 1px solid color-mix(in oklab, var(--tckr-color-warning) 26%, transparent);
}
.tckr-conn-banner--danger {
  background: color-mix(in oklab, var(--tckr-color-down) 9%, transparent);
  border: 1px solid color-mix(in oklab, var(--tckr-color-down) 26%, transparent);
}
.tckr-conn-banner__icon { flex: none; font-size: 15px; color: var(--tckr-color-warning); }
.tckr-conn-banner--danger .tckr-conn-banner__icon { color: var(--tckr-color-down); }
.tckr-conn-banner__body { flex: 1 1 auto; min-width: 0; }
.tckr-conn-banner__title { font-weight: 600; font-size: 0.85rem; }
.tckr-conn-banner__detail { margin-top: 3px; font-size: 0.78rem; color: var(--tckr-color-text-muted); }
.tckr-conn-banner__action {
  flex: none;
  font: inherit;
  font-weight: 600;
  font-size: 0.75rem;
  padding: 7px 13px;
  border-radius: 6px;
  border: 1px solid var(--tckr-color-border);
  background: var(--tckr-color-text);
  color: var(--tckr-color-surface);
  cursor: pointer;
  transition: transform 120ms ease-out, opacity 150ms ease;
}
.tckr-conn-banner__action:focus-visible { outline: 2px solid var(--tckr-color-accent); outline-offset: 2px; }
.tckr-conn-banner__action:active { transform: scale(0.96); }

.tckr-stocklist__toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.tckr-stocklist__pills { display: flex; gap: 6px; flex-wrap: wrap; }
.tckr-pill {
  font: inherit;
  font-size: 0.72rem;
  font-weight: 500;
  padding: 7px 12px;
  border-radius: 999px;
  border: 1px solid var(--tckr-color-border);
  background: transparent;
  color: var(--tckr-color-text-muted);
  cursor: pointer;
  transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease, transform 120ms ease-out;
}
.tckr-pill--active { background: var(--tckr-color-text); color: var(--tckr-color-surface); border-color: var(--tckr-color-text); font-weight: 600; }
.tckr-pill:focus-visible { outline: 2px solid var(--tckr-color-accent); outline-offset: 2px; }
.tckr-pill:active { transform: scale(0.96); }
.tckr-stocklist__search-wrap {
  flex: 1 1 240px;
  min-width: 160px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border: 1px solid var(--tckr-color-border);
  border-radius: 8px;
  background: var(--tckr-color-surface-raised);
  transition: border-color 150ms ease;
}
.tckr-stocklist__search-wrap:focus-within { outline: 2px solid var(--tckr-color-accent); outline-offset: 2px; }
.tckr-stocklist__search-icon { color: var(--tckr-color-text-muted); font-size: 13px; flex: none; }
.tckr-stocklist__search {
  all: unset;
  flex: 1 1 auto;
  min-width: 0;
  color: var(--tckr-color-text);
  font-size: 0.85rem;
}
.tckr-stocklist__search::placeholder { color: var(--tckr-color-text-muted); }
.tckr-stocklist__kbd {
  flex: none;
  font-family: var(--tckr-font-mono);
  font-size: 0.65rem;
  color: var(--tckr-color-text-muted);
  border: 1px solid var(--tckr-color-border);
  border-radius: 4px;
  padding: 3px 6px;
}
.tckr-stocklist__table-wrap { width: 100%; max-width: 100%; border: 1px solid var(--tckr-color-border); border-radius: 10px; overflow: hidden; background: var(--tckr-color-surface); }
.tckr-stocklist__table { width: 100%; max-width: 100%; border-collapse: collapse; table-layout: fixed; }
.tckr-stocklist__table th,
.tckr-stocklist__table td {
  padding: 11px 10px;
  text-align: left;
  border-bottom: 1px solid var(--tckr-color-border);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tckr-stocklist__table thead th {
  font-family: var(--tckr-font-mono);
  font-size: 0.62rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--tckr-color-text-muted);
  text-transform: uppercase;
  background: var(--tckr-color-surface-raised);
}
.tckr-stocklist__cell--symbol { font-family: var(--tckr-font-mono); font-weight: 700; }
.tckr-stocklist__cell--numeric { text-align: right; font-variant-numeric: tabular-nums; }
.tckr-stocklist__sort-button {
  all: unset;
  cursor: pointer;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.tckr-stocklist__sort-button:focus-visible { outline: 2px solid var(--tckr-color-accent); outline-offset: 2px; }
.tckr-stocklist__row { cursor: pointer; transition: background-color 120ms ease; }
@media (hover: hover) and (pointer: fine) {
  .tckr-stocklist__row:hover { background: var(--tckr-color-surface-raised); }
}
.tckr-stocklist__row:focus-visible { outline: 2px solid var(--tckr-color-accent); outline-offset: -2px; }
.tckr-stocklist--stale .tckr-stocklist__table-wrap { transition: opacity 250ms ease; opacity: 0.72; }
.tckr-stocklist__changepct {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 5px;
  background: var(--tckr-color-surface-raised);
}
.tckr-stocklist__changepct { transition: background-color 200ms ease; }
.tckr-stocklist__changepct.tckr-delta--up { background: color-mix(in oklab, var(--tckr-color-up) 14%, transparent); }
.tckr-stocklist__changepct.tckr-delta--down { background: color-mix(in oklab, var(--tckr-color-down) 14%, transparent); }
.tckr-sparkline { width: 100%; height: 34px; display: block; }
.tckr-sparkline__line { stroke-width: 1.6; transition: stroke 200ms ease; }
.tckr-sparkline__line--up { stroke: var(--tckr-color-up); }
.tckr-sparkline__line--down { stroke: var(--tckr-color-down); }
.tckr-sparkline__line--flat { stroke: var(--tckr-color-text-muted); }
.tckr-stocklist__empty { text-align: center; color: var(--tckr-color-text-muted); padding: 44px 16px; white-space: normal; animation: tckr-fade-in 200ms ease-out; }
.tckr-stocklist__empty-count { font-family: var(--tckr-font-mono); font-size: 0.78rem; letter-spacing: 0.04em; }
.tckr-stocklist__empty-title { margin-top: 12px; font-weight: 700; font-size: 1.05rem; color: var(--tckr-color-text); }
.tckr-stocklist__empty-detail { margin: 8px auto 0; max-width: 340px; font-size: 0.82rem; line-height: 1.55; }
.tckr-stocklist__empty-actions { margin-top: 18px; display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.tckr-stocklist__empty-actions button {
  font: inherit;
  font-weight: 600;
  font-size: 0.78rem;
  padding: 9px 14px;
  border-radius: 7px;
  cursor: pointer;
  transition: transform 120ms ease-out, opacity 150ms ease;
}
.tckr-stocklist__empty-actions button:active { transform: scale(0.96); }
.tckr-stocklist__empty-actions button:first-child { border: none; background: var(--tckr-color-text); color: var(--tckr-color-surface); }
.tckr-stocklist__empty-actions button:last-child { border: 1px solid var(--tckr-color-border); background: transparent; color: var(--tckr-color-text); }
.tckr-stocklist__empty-actions button:focus-visible { outline: 2px solid var(--tckr-color-accent); outline-offset: 2px; }
.tckr-stocklist__loading { color: var(--tckr-color-text-muted); }
@media (max-width: 640px) {
  .tckr-stocklist__col--narrow-hide { display: none; }
}
`;

interface StockListRowProps {
  readonly definition: SymbolDefinition;
  readonly priceDecimals: number;
  readonly onActivate: (symbol: string) => void;
}

function StockListRow({ definition, priceDecimals, onActivate }: StockListRowProps) {
  const { symbol, name, referencePrice } = definition;

  // A hot symbol can tick dozens of times/sec even after `TickDispatcher`'s per-frame
  // coalescing (that cap is a data-correctness contract, not a readability one — see
  // `src/display/throttle.ts`). This row must repaint at most once per
  // `DISPLAY_REFRESH_INTERVAL_MS`, from *either* of two triggers: a real store
  // notification (for instant feedback on an isolated tick after a quiet spell) or a
  // fallback clock (so "Last update" keeps advancing, and a burst gets an eventual
  // repaint, even if no single tick alone would have qualified as "isolated"). An
  // earlier version of this file ran those two triggers as fully independent timers —
  // `createThrottle`'s own internal one for the subscription, plus a separate
  // `setInterval` for the clock — anchored at different moments (first-tick time vs.
  // mount time). Independent timers drift apart and can land within milliseconds of
  // each other, producing two back-to-back renders that are each individually correct
  // but together read as a rapid, contradictory-looking double-flash.
  //
  // `lastRenderAtRef` is the single shared gate that replaces both timers' own
  // bookkeeping: a candidate render (from either trigger) proceeds only if at least one
  // full window has passed since the last one *from either source*, so the two
  // triggers can never both fire within the same window. It starts at `-Infinity` so
  // the very first tick this row ever sees is never suppressed — a quiet symbol still
  // feels instant the moment it starts ticking.
  const lastRenderAtRef = useRef(-Infinity);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const unsubscribe = subscribeSymbol(symbol, () => {
        const now = Date.now();
        if (now - lastRenderAtRef.current < DISPLAY_REFRESH_INTERVAL_MS) {
          return;
        }
        lastRenderAtRef.current = now;
        onStoreChange();
      });
      return unsubscribe;
    },
    [symbol],
  );
  const view = useSyncExternalStore(subscribe, () => getSymbolSnapshot(symbol));

  // The fallback clock: guarantees a repaint at least once per window even during a
  // burst too continuous to ever look "isolated" to the subscription above, and keeps
  // "Last update" advancing when the symbol goes fully quiet. Gated by the same
  // `lastRenderAtRef`, so it never doubles up with a real update that already
  // refreshed the row this window.
  const [, forceClockTick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      if (now - lastRenderAtRef.current < DISPLAY_REFRESH_INTERVAL_MS) {
        return;
      }
      lastRenderAtRef.current = now;
      forceClockTick();
    }, DISPLAY_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

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
  const lastUpdateLabel = view ? formatRelativeTime(view.lastUpdate, Date.now()) : '—';

  // Decorative sparkline history — bounded, committed post-render (see module doc for
  // why this mirrors PriceCell's flash-tracking shape rather than mutating during
  // render). Never read as text anywhere; text prices always go through PriceCell.
  const historyRef = useRef<number[]>([]);
  const currentPriceNum = Number(price);
  useEffect(() => {
    const last = historyRef.current[historyRef.current.length - 1];
    if (last !== currentPriceNum) {
      historyRef.current = [...historyRef.current, currentPriceNum].slice(-20);
    }
  }, [currentPriceNum]);
  const sparklinePoints =
    historyRef.current[historyRef.current.length - 1] === currentPriceNum
      ? historyRef.current
      : [...historyRef.current, currentPriceNum];
  const sparklineDirection: 'up' | 'down' | 'flat' =
    changePercent === undefined || changePercent === 0 ? 'flat' : changePercent > 0 ? 'up' : 'down';

  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate(symbol);
    }
  };

  return (
    <tr
      className="tckr-stocklist__row"
      tabIndex={0}
      aria-label={symbol}
      data-symbol={symbol}
      data-render-count={renderCountRef.current}
      onClick={() => onActivate(symbol)}
      onKeyDown={handleKeyDown}
    >
      <td className="tckr-stocklist__cell tckr-stocklist__cell--symbol">{symbol}</td>
      <td className="tckr-stocklist__cell tckr-stocklist__col--narrow-hide">
        <Sparkline points={sparklinePoints} direction={sparklineDirection} />
      </td>
      <td className="tckr-stocklist__cell tckr-stocklist__col--narrow-hide">{name}</td>
      <td className="tckr-stocklist__cell tckr-stocklist__cell--numeric">
        <PriceCell
          value={price}
          decimals={priceDecimals}
          muted={priceMuted}
          flashDirectionOverride={
            changePercent === undefined ? undefined : changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : null
          }
        />
      </td>
      <td className="tckr-stocklist__cell tckr-stocklist__cell--numeric tckr-stocklist__col--narrow-hide">
        <PriceCell value={change} decimals={priceDecimals} sign muted={priceMuted} indicateSign />
      </td>
      <td className="tckr-stocklist__cell tckr-stocklist__cell--numeric">
        {changePercent === undefined ? (
          <span className="tckr-price-cell tckr-price-cell--muted">—</span>
        ) : (
          <span
            className={`tckr-price-cell tckr-stocklist__changepct${
              changePercent > 0 ? ' tckr-delta--up' : changePercent < 0 ? ' tckr-delta--down' : ''
            }`}
          >
            {formatSignedPercent(changePercent)}
          </span>
        )}
      </td>
      <td className="tckr-stocklist__cell tckr-stocklist__cell--numeric tckr-stocklist__col--narrow-hide">
        {volumeLabel}
      </td>
      <td className="tckr-stocklist__cell tckr-stocklist__col--narrow-hide">{lastUpdateLabel}</td>
    </tr>
  );
}

export function StockList() {
  const navigate = useNavigate();
  const subscribedRef = useRef<readonly string[]>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [universe, setUniverse] = useState<readonly SymbolDefinition[] | null>(null);
  const [rawQuery, setRawQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sortState, setSortState] = useState<SortState | null>(null);
  const { state: connState, remainingSecs } = useConnectionBanner();

  useEffect(() => {
    // `getSharedSource()` is the one app-wide `MarketDataSource` instance — it connects
    // itself, once, at first access (client-contract.md §3: one connection per client).
    // StockList must not call `.connect()`/`.disconnect()` on it: disconnecting here
    // would kill the connection StockDetail shares. Leaving the route only releases
    // this page's own subscriptions.
    const source = getSharedSource();
    let cancelled = false;

    source.getUniverse().then((response) => {
      if (cancelled) {
        return;
      }
      const symbols = response.symbols.map((def) => def.symbol);
      subscribedRef.current = symbols;
      source.subscribe(symbols);
      setUniverse(response.symbols);
    });

    return () => {
      cancelled = true;
      if (subscribedRef.current.length > 0) {
        source.unsubscribe(subscribedRef.current);
        subscribedRef.current = [];
      }
    };
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(rawQuery), 150);
    return () => clearTimeout(handle);
  }, [rawQuery]);

  // ⌘K / Ctrl+K focuses the search box — additive convenience, no existing behaviour
  // touched.
  useEffect(() => {
    function handleGlobalKeyDown(event: globalThis.KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const priceDecimalsBySymbol = useMemo(() => {
    const map = new Map<string, number>();
    for (const def of universe ?? []) {
      map.set(def.symbol, Math.max(decimalPlacesOf(def.referencePrice), decimalPlacesOf(def.tickSize)));
    }
    return map;
  }, [universe]);

  const filtered = useMemo(() => {
    if (!universe) {
      return [];
    }
    const query = debouncedQuery.trim().toLowerCase();
    if (query === '') {
      return universe;
    }
    return universe.filter(
      (def) => def.symbol.toLowerCase().includes(query) || def.name.toLowerCase().includes(query),
    );
  }, [universe, debouncedQuery]);

  const sorted = useMemo(() => {
    if (!sortState) {
      return filtered;
    }
    const { column, direction } = sortState;
    const factor = direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => factor * compareBy(column, a, b));
  }, [filtered, sortState]);

  const handleSort = useCallback((column: SortColumn) => {
    setSortState((current) => {
      if (!current || current.column !== column) {
        return { column, direction: 'asc' };
      }
      if (current.direction === 'asc') {
        return { column, direction: 'desc' };
      }
      return null;
    });
  }, []);

  const handleRowActivate = useCallback(
    (symbol: string) => {
      navigate(`/symbols/${symbol}`);
    },
    [navigate],
  );

  const clearSearch = useCallback(() => setRawQuery(''), []);

  if (universe === null) {
    return <p className="tckr-stocklist__loading">Loading instruments…</p>;
  }

  const isStale = connState.kind === 'reconnecting' || connState.kind === 'closed';
  const activePreset = presetFor(sortState);

  return (
    <div className={`tckr-stocklist${isStale ? ' tckr-stocklist--stale' : ''}`}>
      <style>{STOCK_LIST_STYLES}</style>

      <TickerTape universe={universe} held={isStale} />
      <ConnectionBanner state={connState} remainingSecs={remainingSecs} />

      <div className="tckr-stocklist__toolbar">
        <div className="tckr-stocklist__pills">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`tckr-pill${activePreset === preset.id ? ' tckr-pill--active' : ''}`}
              onClick={() => setSortState(preset.sort)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <label className="tckr-stocklist__search-wrap" htmlFor="tckr-stocklist-search">
          <span className="tckr-stocklist__search-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            id="tckr-stocklist-search"
            ref={searchInputRef}
            type="search"
            className="tckr-stocklist__search"
            aria-label="Search symbol or name"
            placeholder="Search symbol or name"
            value={rawQuery}
            onChange={(event) => setRawQuery(event.target.value)}
          />
          <span className="tckr-stocklist__kbd">⌘K</span>
        </label>
      </div>
      <div className="tckr-stocklist__table-wrap">
        <table className="tckr-stocklist__table">
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  className={column.hideNarrow ? 'tckr-stocklist__col--narrow-hide' : undefined}
                  aria-sort={
                    column.sortable && sortState?.column === column.key
                      ? sortState.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      className="tckr-stocklist__sort-button"
                      onClick={() => handleSort(column.key as SortColumn)}
                    >
                      {column.label}
                      {sortState?.column === column.key ? (sortState.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="tckr-stocklist__empty">
                  <div className="tckr-stocklist__empty-count">0 of {universe.length}</div>
                  <div className="tckr-stocklist__empty-title">No instruments match &ldquo;{rawQuery}&rdquo;</div>
                  <div className="tckr-stocklist__empty-detail">
                    Search runs on symbol and name. Try a shorter query, or browse the full board.
                  </div>
                  <div className="tckr-stocklist__empty-actions">
                    <button type="button" onClick={clearSearch}>
                      Clear search
                    </button>
                    <button type="button" onClick={clearSearch}>
                      Browse all {universe.length}
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              sorted.map((def) => (
                <StockListRow
                  key={def.symbol}
                  definition={def}
                  priceDecimals={priceDecimalsBySymbol.get(def.symbol) ?? 2}
                  onActivate={handleRowActivate}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
