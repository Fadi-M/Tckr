/**
 * The Top Gainer / Top Loser / Most Active highlight cards and their decorative
 * sparkline, split out of `StockList.tsx`. "The module doc" in comments below means
 * `StockList.tsx`'s.
 */
import { useRef, useEffect, useCallback, useSyncExternalStore, useReducer, useMemo } from 'react';
import { toPlotValue } from '../chart/ringBuffer.ts';
import { DELTA_TONE_CLASSES } from '../components/deltaTone.ts';
import { ClockIcon } from '../components/icons.tsx';
import { PriceCell } from '../components/PriceCell.tsx';
import { TickingText } from '../components/RollingText.tsx';
import { compare, formatCompact } from '../contracts/decimal.ts';
import type { SymbolDefinition } from '../contracts/rest.ts';
import {
  getPacedSymbolSnapshot,
  subscribePacedSymbol,
  subscribeBeat,
} from '../display/pacedViews.ts';
import { formatPercentFigure } from '../display/percent.ts';
import { ScrambleWord } from '../motion/ScrambleWord.tsx';
import {
  tradedValue,
  isEffectivelyUnchanged,
  formatSignedPercent,
  percentTone,
} from './boardColumns.tsx';
import { useSessionSparkline, sparklineDirection } from './useBoundedSparkline.ts';

// ---------------------------------------------------------------------------------
// Sparkline — decorative only. See module doc for the "text vs. pixel geometry"
// boundary this keeps.
// ---------------------------------------------------------------------------------
export function Sparkline({
  points,
  direction,
  variant = 'row',
}: {
  points: readonly number[];
  direction: 'up' | 'down' | 'flat';
  /** `'row'` (the default, `StockListRow`'s inline cell) sizes to `width:100%;
   * height:24px` (`h-6`). `'hero'` (`HeroCard`'s price row) instead sizes to the fixed
   * `96px x 30px` the design gives it there — this is a *different, non-overlapping*
   * className, not a base-then-override pair, so the two sizings never fight over
   * the same `width`/`height` utility (previously a `.tckr-hero__price-row
   * .tckr-sparkline` descendant-selector override). */
  variant?: 'row' | 'hero';
}) {
  const sizeClass = variant === 'hero' ? 'block w-24 h-[30px] flex-none' : 'block w-full h-6';
  const lineClass = `[stroke-width:1.6] [transition:stroke_200ms_ease] ${direction === 'up' ? 'stroke-up' : direction === 'down' ? 'stroke-down' : 'stroke-text-muted'}`;
  if (points.length < 2) {
    return (
      <svg viewBox="0 0 100 34" preserveAspectRatio="none" className={sizeClass} aria-hidden="true">
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
    <svg viewBox="0 0 100 34" preserveAspectRatio="none" className={sizeClass} aria-hidden="true">
      <polyline points={coords} fill="none" className={lineClass} />
    </svg>
  );
}
// ---------------------------------------------------------------------------------
// Hero cards — Top Gainer / Top Loser / Most Active. See module doc.
// ---------------------------------------------------------------------------------
interface HeroPick {
  readonly kind: 'gainer' | 'loser' | 'active';
  readonly kicker: string;
  readonly definition: SymbolDefinition;
}
/** Imperative, one-shot read of the whole universe's current snapshots — same
 * "poll on an interval, never subscribe per-tick" discipline as `TickerTape`/the
 * active-sort-preset resort above. Falls back to each definition's own
 * `referencePrice`/0 for a symbol with no snapshot yet (pre-first-tick), so the
 * picks are stable even immediately after mount. */
function pickHeroes(universe: readonly SymbolDefinition[]): readonly HeroPick[] {
  if (universe.length === 0) {
    return [];
  }
  const metrics = universe.map((definition) => {
    const view = getPacedSymbolSnapshot(definition.symbol);
    return { definition, changePercent: view?.changePercent ?? 0, value: tradedValue(definition) };
  });
  const gainer = [...metrics].sort((a, b) => b.changePercent - a.changePercent)[0]!;
  const loser = [...metrics].sort((a, b) => a.changePercent - b.changePercent)[0]!;
  const active = [...metrics].sort((a, b) => compare(b.value, a.value))[0]!;
  const candidates: readonly HeroPick[] = [
    { kind: 'gainer', kicker: 'TOP GAINER', definition: gainer.definition },
    { kind: 'loser', kicker: 'TOP LOSER', definition: loser.definition },
    { kind: 'active', kicker: 'MOST ACTIVE', definition: active.definition },
  ];
  // A card only shows a symbol its label is true of: when nothing on the board is up,
  // there is no top gainer (the least-down stock is not one), and likewise for losers.
  // A tiny universe (or a fixture in a test) can have the same symbol win more than
  // one slot — keep only the first (highest-priority) pick per symbol so a card never
  // renders twice.
  const qualifies = (pick: HeroPick, changePercent: number): boolean =>
    pick.kind === 'active' ||
    (!isEffectivelyUnchanged(changePercent) &&
      (pick.kind === 'gainer' ? changePercent > 0 : changePercent < 0));
  const changeOf = new Map(metrics.map((m) => [m.definition.symbol, m.changePercent]));
  const seen = new Set<string>();
  return candidates.filter((pick) => {
    if (!qualifies(pick, changeOf.get(pick.definition.symbol) ?? 0)) {
      return false;
    }
    if (seen.has(pick.definition.symbol)) {
      return false;
    }
    seen.add(pick.definition.symbol);
    return true;
  });
}
interface HeroCardProps {
  readonly kicker: string;
  readonly kind: HeroPick['kind'];
  readonly definition: SymbolDefinition;
  readonly priceDecimals: number;
  readonly onActivate: (symbol: string) => void;
  /** Same as `StockListRowProps.sessionTrend`. */
  readonly sessionTrend?: readonly number[] | undefined;
  /** While EGX is closed the picks describe a past session, e.g. `"Thu 24 Sep"`;
   * `undefined` while it trades, when "today" goes without saying. */
  readonly sessionDate?: string | undefined;
  /** The card's place in the row, which staggers its closing-bell label. */
  readonly index?: number;
}
// `all: unset` on the card button had no direct Tailwind equivalent (see module's
// migration notes) — only the native-button chrome that the rest of this rule does
// NOT go on to re-declare (appearance, margin, outline, inherited text properties)
// needs an explicit reset here; every property the original rule re-declares after
// `all: unset` (box-sizing, cursor, width, padding, border-radius, background,
// backdrop-filter, border, box-shadow, transition) is just applied directly below,
// with no separate reset step, so there is never a same-property class pair whose
// winner depends on Tailwind's internal utility ordering.
const HERO_CARD_CLASS =
  'appearance-none m-0 p-0 outline-none text-inherit text-left box-border cursor-pointer w-full max-[640px]:w-[78%] max-[640px]:flex-none max-[640px]:snap-start max-[640px]:pt-3 max-[640px]:px-4 max-[640px]:pb-3 pt-4 px-[18px] pb-[15px] rounded-[20px] bg-glass border border-glass-border shadow-float backdrop-blur-tckr backdrop-saturate-[1.6] [transition:transform_160ms_ease-out,border-color_160ms_ease] fine-hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent focus-visible:outline-offset-2 reduced-transparency:bg-surface reduced-transparency:backdrop-blur-none reduced-transparency:backdrop-saturate-100 contrast-more:bg-surface contrast-more:backdrop-blur-none contrast-more:backdrop-saturate-100';
function HeroCard({
  kicker,
  kind,
  definition,
  priceDecimals,
  onActivate,
  sessionTrend,
  sessionDate,
  index = 0,
}: HeroCardProps) {
  const { symbol, name, referencePrice } = definition;

  // The closing bell: when EGX closes while this card is on screen, its label's session
  // day ("· THU") resolves in, the three cards one after another, marking that the picks
  // are now a recap. A page opened on a closed market just shows it (never on first paint).
  const sawTrading = useRef(sessionDate === undefined);
  const closedWhileWatching = sawTrading.current && sessionDate !== undefined;
  useEffect(() => {
    sawTrading.current = sessionDate === undefined;
  }, [sessionDate]);

  // Same throttled-subscribe shape as `StockListRow` — see that component's doc for
  // why a hand-rolled interval/gate is the wrong tool here.
  // Paced, not live: a render between beats (a click, a sort) shows what the last beat
  // painted — see `src/display/pacedViews.ts`.
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribePacedSymbol(symbol, onStoreChange),
    [symbol],
  );
  const view = useSyncExternalStore(subscribe, () => getPacedSymbolSnapshot(symbol));

  const priceMuted = view === undefined;
  const price = view?.price ?? referencePrice;
  const changePercent = view?.changePercent;
  const valueLabel = view ? `EGP ${formatCompact(tradedValue(definition, view))}` : '—';
  const delayed = view?.stream === 'DELAYED';

  // Session sparkline — same shape/purpose as `StockListRow`'s (decorative only; every
  // price shown as *text* here still goes through `PriceCell`), seeded from the
  // session history via `useSessionSparkline`, with this card's own 26-point cap.
  const currentPriceNum = toPlotValue(price);
  const sparklinePoints = useSessionSparkline(currentPriceNum, 26, sessionTrend);
  const direction = sparklineDirection(changePercent);

  const badgeText =
    kind === 'active'
      ? valueLabel
      : changePercent === undefined
        ? '—'
        : formatSignedPercent(changePercent);
  // Most active shows a traded value, not a move, so its badge stays neutral.
  const badgeDeltaClass =
    DELTA_TONE_CLASSES[kind === 'active' ? 'flat' : percentTone(changePercent)];

  const directionWord = direction === 'flat' ? 'unchanged' : direction;
  // On a closed day "Top gainer" would otherwise read as today's; the weekday alone
  // fits the card's label row, and the accessible name carries the full date.
  const kickerDay =
    sessionDate === undefined ? null : ` · ${sessionDate.split(' ')[0]!.toUpperCase()}`;
  const spokenKicker = sessionDate === undefined ? kicker : `${kicker}, ${sessionDate} session`;
  const baseAriaLabel =
    kind === 'active'
      ? `${spokenKicker}: ${symbol}, ${String(price)}, traded value ${valueLabel}`
      : changePercent === undefined
        ? `${spokenKicker}: ${symbol}, ${String(price)}`
        : `${spokenKicker}: ${symbol}, ${String(price)}, ${directionWord} ${formatPercentFigure(changePercent, { magnitude: true })}%`;
  // Same rule as a board row: a delayed price is never read, or shown, as live.
  const ariaLabel = delayed ? `${baseAriaLabel}, delayed stream` : baseAriaLabel;

  return (
    <button
      type="button"
      className={HERO_CARD_CLASS}
      aria-label={ariaLabel}
      onClick={() => onActivate(symbol)}
    >
      <div className="flex items-center justify-between gap-2.5">
        <span
          className={`inline-flex items-center gap-1.5 font-mono text-label font-semibold tracking-[0.14em] ${delayed ? 'text-warning' : 'text-text-muted'}`}
          aria-hidden="true"
        >
          {delayed ? <ClockIcon size={11} /> : null}
          <span>
            {kicker}
            {kickerDay === null ? null : (
              <ScrambleWord
                key={kickerDay}
                text={kickerDay}
                from={closedWhileWatching ? '' : undefined}
                delay={index * 0.09}
              />
            )}
          </span>
        </span>
        <span
          className={`font-mono text-label font-semibold px-2.5 py-[3px] rounded-full whitespace-nowrap [transition:background-color_600ms_var(--tckr-ease-out),color_600ms_var(--tckr-ease-out)] ${badgeDeltaClass}`}
          aria-hidden="true"
        >
          <TickingText
            text={badgeText}
            direction={changePercent !== undefined && changePercent < 0 ? 'down' : 'up'}
          />
        </span>
      </div>
      <div className="flex items-baseline gap-2 mt-3 min-w-0" aria-hidden="true">
        <span className="font-mono font-semibold text-title">{symbol}</span>
        <span className="text-caption text-text-muted overflow-hidden text-ellipsis whitespace-nowrap">
          {name}
        </span>
      </div>
      <div className="flex items-end justify-between gap-2.5 mt-2.5" aria-hidden="true">
        <span className="font-mono font-semibold text-price">
          <PriceCell
            value={price}
            decimals={priceDecimals}
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
        </span>
        <Sparkline points={sparklinePoints} direction={direction} variant="hero" />
      </div>
    </button>
  );
}
export function HeroCards({
  universe,
  priceDecimalsBySymbol,
  onActivate,
  sessionTrends,
  sessionDate,
}: {
  universe: readonly SymbolDefinition[] | null;
  priceDecimalsBySymbol: Map<string, number>;
  onActivate: (symbol: string) => void;
  sessionTrends: ReadonlyMap<string, readonly number[]>;
  sessionDate: string | undefined;
}) {
  // Top Gainer / Top Loser / Most Active — re-picked on the price beat itself
  // (`subscribeBeat`), in the same commit as the figures they are picked by, so a card's
  // label and its numbers are one read and can never contradict each other. The pick
  // lives here, not in `StockList`, so a beat re-renders these cards and never the
  // board's 34 rows.
  const [heroTick, forceHeroRecompute] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!universe) {
      return undefined;
    }
    return subscribeBeat(forceHeroRecompute);
  }, [universe]);
  // `heroTick` is intentionally in this array even though the body never reads it —
  // bumping it is exactly what forces this memo to recompute on the beat above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const picks = useMemo(() => (universe ? pickHeroes(universe) : []), [universe, heroTick]);
  if (picks.length === 0) {
    return null;
  }
  return (
    // Below 640px the three cards stacked to ~430px and pushed the board — the page's
    // reason to exist — below the first screen. There they become one swipeable row
    // (the next card peeks in at the edge, so the row reads as scrollable) that bleeds
    // to the screen edge; the glass shadows get vertical room so the scroller doesn't
    // clip them.
    <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))] max-[640px]:flex max-[640px]:gap-2.5 max-[640px]:overflow-x-auto max-[640px]:snap-x max-[640px]:snap-mandatory max-[640px]:-mx-3 max-[640px]:px-3 max-[640px]:scroll-px-3 max-[640px]:pt-0.5 max-[640px]:pb-3 max-[640px]:-mb-3 max-[640px]:[scrollbar-width:none] max-[640px]:[&::-webkit-scrollbar]:hidden">
      {picks.map((pick, index) => (
        <HeroCard
          key={pick.kind}
          index={index}
          kicker={pick.kicker}
          kind={pick.kind}
          definition={pick.definition}
          priceDecimals={priceDecimalsBySymbol.get(pick.definition.symbol) ?? 2}
          onActivate={onActivate}
          sessionTrend={sessionTrends.get(pick.definition.symbol)}
          sessionDate={sessionDate}
        />
      ))}
    </div>
  );
}
