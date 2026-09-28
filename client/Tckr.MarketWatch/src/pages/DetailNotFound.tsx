/**
 * The detail pane for a ticker outside the universe: says so plainly, offers the closest
 * instruments ("Did you mean") when there are any, and links back to the board. Split
 * out of `StockDetail.tsx`.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { SymbolDefinition } from '../contracts/rest.ts';
import { ArrowLeftIcon } from '../components/icons.tsx';
import { DETAIL_PANEL_CLASS } from './detailChrome.tsx';
import { DETAIL_HEADING_ID } from './pageAnchors.ts';
import { symbolPath } from './routes.ts';

export function DetailNotFound({
  symbol,
  suggestions,
}: {
  readonly symbol: string;
  readonly suggestions: readonly SymbolDefinition[];
}): JSX.Element {
  return (
    <div className={`${DETAIL_PANEL_CLASS} gap-3 text-text`} data-testid="stock-detail-not-found">
      <h2 id={DETAIL_HEADING_ID} tabIndex={-1} className="font-semibold text-title outline-none">
        No EGX instrument called &ldquo;<span className="font-mono">{symbol}</span>&rdquo;
      </h2>
      {suggestions.length > 0 ? (
        <>
          <p className="text-small text-text-muted">Did you mean</p>
          <div className="flex gap-2 flex-wrap">
            {suggestions.map((def) => (
              <Link
                key={def.symbol}
                to={symbolPath(def.symbol)}
                className="inline-flex items-baseline gap-2 rounded-[7px] border border-border px-3.5 py-2 text-caption no-underline text-text fine-hover:bg-[color-mix(in_oklab,var(--tckr-color-text)_6%,transparent)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent focus-visible:outline-offset-2 active:scale-[0.96] [transition:background-color_150ms_ease,transform_120ms_ease-out]"
              >
                <span className="font-mono font-semibold">{def.symbol}</span>
                <span className="text-text-muted">{def.name}</span>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <p className="text-small text-text-muted">Check the ticker, or find it on the board.</p>
      )}
      {/* Phones already have "All instruments" in the row above the pane. */}
      <p className="max-[800px]:hidden">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-caption text-text-muted no-underline fine-hover:text-text focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent focus-visible:outline-offset-2 rounded-[4px]"
        >
          <ArrowLeftIcon size={14} />
          All instruments
        </Link>
      </p>
    </div>
  );
}
