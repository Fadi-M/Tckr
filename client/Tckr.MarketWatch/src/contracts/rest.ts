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
