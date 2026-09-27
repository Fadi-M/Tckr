/**
 * "Did you mean": the instruments closest to a query that matched nothing. Shared by the
 * board's empty search and the detail pane's not-found state, so a mistyped ticker gets
 * the same suggestions whether it was typed into the search box or a URL.
 */
import type { SymbolDefinition } from '../contracts/rest.ts';

/** Levenshtein distance, for the empty-search "closest matches". Inputs are short
 * (a query against a 3–5 letter ticker or one word of a name), so O(n·m) is nothing. */
function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length]!;
}

/**
 * Up to `limit` instruments closest to a query that matched nothing — a typo'd ticker
 * ("COMY" → COMI) or a misspelled word of a company name ("orascon" → ORAS). Compares
 * the query with the symbol, and with the same-length start of each word of the name
 * (ticker matches rank first);
 * a candidate must be within roughly one edit per three characters to be offered at all,
 * so an unrelated query gets no suggestions rather than random ones.
 */
export function closestInstruments(
  query: string,
  universe: readonly SymbolDefinition[],
  limit = 3,
): SymbolDefinition[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) {
    return [];
  }
  const allowed = Math.max(1, Math.floor(q.length / 3));
  const candidates = universe
    .map((def) => {
      const nameWordStarts = def.name.toLowerCase().split(/\s+/).map((word) => word.slice(0, q.length));
      const symbolDistance = editDistance(q, def.symbol.toLowerCase());
      const nameDistance = Math.min(...nameWordStarts.map((start) => editDistance(q, start)));
      // At equal distance a ticker match outranks a name-word match: the search box
      // is mostly typed into with tickers, so "COMY" means COMI before "Company".
      const rank = Math.min(symbolDistance * 2, nameDistance * 2 + 1);
      return { def, distance: Math.min(symbolDistance, nameDistance), rank };
    })
    .filter(({ distance }) => distance <= allowed);
  // A ticker-shaped query ("COMY") with a close ticker means a mistyped ticker: a
  // name-word near-miss ("Company" -> ARCC) beside it is noise, not a second guess.
  const tickerShaped = /^[a-z0-9]{2,6}$/.test(q);
  const tickerMatches = candidates.filter(({ def }) => editDistance(q, def.symbol.toLowerCase()) <= allowed);
  return (tickerShaped && tickerMatches.length > 0 ? tickerMatches : candidates)
    .sort((a, b) => a.rank - b.rank || a.def.symbol.localeCompare(b.def.symbol))
    .slice(0, limit)
    .map(({ def }) => def);
}
