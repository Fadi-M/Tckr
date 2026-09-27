/**
 * URL shapes for the pages. Symbol routes are scoped to a market (`/EGX/symbols/COMI`):
 * only EGX is served today, but a ticker is only unique within its exchange, so the
 * market segment is in the URL from the start rather than retrofitted when a second
 * market arrives. Every link and `useMatch` goes through this module — never a
 * hand-written path.
 */

import { MARKET } from '../contracts/rest.ts';

/** The symbol detail route, relative to `/` (for a nested `<Route path>`). */
export const SYMBOL_ROUTE = `${MARKET}/symbols/:symbol`;

/** The same route as an absolute pattern (for `useMatch`). */
export const SYMBOL_ROUTE_PATTERN = `/${SYMBOL_ROUTE}`;

/** The pre-market-scoped route, kept only to redirect old links and bookmarks. */
export const LEGACY_SYMBOL_ROUTE_PATTERN = '/symbols/:symbol';

export function symbolPath(symbol: string): string {
  return `/${MARKET}/symbols/${encodeURIComponent(symbol)}`;
}
