/**
 * TypeScript mirror of client-contract.md §2 (REST), field for field.
 *
 * `changePercent` and `lastEventId` are plain `string`, not `DecimalString`:
 * `changePercent` is presentational (the wire equivalent of `decimal.ts`'s
 * `percentChange`) and never participates in price arithmetic, and `lastEventId` is
 * an opaque event identifier, not a quantity. See "Notes for other tasks" in
 * 01-scaffold-contracts-and-fixtures.md.
 */
import type { DecimalString } from './decimal.ts';
import type { IsoUtc, Stream } from './messages.ts';

export interface SymbolDefinition {
  readonly symbol: string;
  readonly name: string;
  readonly currency: string;
  readonly tickSize: DecimalString;
  readonly lotSize: number;
  readonly referencePrice: DecimalString;
}

export interface SymbolUniverseResponse {
  readonly v: 1;
  readonly asOf: IsoUtc;
  readonly simulated: boolean;
  readonly symbols: readonly SymbolDefinition[];
}

/** One session-history sample: a price at a point in time. `t` is the exchange's UTC
 * timestamp the sample was taken at (a server-defined sampling cadence, not every
 * tick), not the time the client happened to receive it. */
export interface HistoryPoint {
  readonly t: IsoUtc;
  readonly p: DecimalString;
}

/** `GET /symbols/{symbol}/history` (client-contract.md). Every price sample recorded
 * for `symbol` since the session began, oldest first — lets a client that opens a
 * symbol mid-session (e.g. at noon, for a session that opened at 9:30) render the full
 * session line immediately, instead of only the samples that happen to arrive after it
 * starts watching. `points` may be empty for a symbol with no samples yet. */
export interface SymbolHistoryResponse {
  readonly v: 1;
  readonly symbol: string;
  readonly points: readonly HistoryPoint[];
}

export interface Snapshot {
  readonly v: 1;
  readonly symbol: string;
  readonly stream: Stream;
  readonly price: DecimalString;
  readonly change: DecimalString;
  readonly changePercent: string;
  readonly open: DecimalString;
  readonly high: DecimalString;
  readonly low: DecimalString;
  readonly volume: number;
  readonly lastEventId: string;
  readonly exchangeTimestamp: IsoUtc;
  readonly snapshotAge: number;
  readonly simulated: boolean;
}
