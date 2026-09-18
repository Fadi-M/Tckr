/**
 * The seam. `client-contract.md` describes the wire; this interface is the client-side
 * shape any transport must satisfy to sit behind it. Two implementations exist:
 * `SimulatedSource` (this task, browser-only, no backend) and `TckrGatewaySource` (task
 * 08, real WebSocket + REST, dormant until Phase 11). Nothing outside `src/data/` may
 * import either implementation directly — only `createMarketDataSource` from
 * `config.ts`. See README.md §7/§8 and ADR 006.
 *
 * Every member here must be meaningful for a real gateway, not merely convenient for the
 * simulator. There is deliberately no setter for `identity()` — the stream a client sees
 * is server-assigned, never client-chosen (FR-6).
 */
import type { EntitlementChanged, ErrorMsg, Stream, Tick } from '../contracts/messages.ts';
import type { Snapshot, SymbolHistoryResponse, SymbolUniverseResponse } from '../contracts/rest.ts';
import type { CloseCode } from '../contracts/closeCodes.ts';

/** The server's account of who this connection is and what it is entitled to see.
 * Populated only from the `connected` server message; there is no client-side setter. */
export interface Identity {
  readonly userId: string;
  readonly stream: Stream;
  readonly sessionId: string;
}

/** Lifecycle of the underlying transport. `SimulatedSource` and `TckrGatewaySource`
 * report the same shape so `ConnectionStatus` (task 07) needs no source-specific case. */
export type ConnectionState =
  | { readonly kind: 'connecting'; readonly attempt: number }
  | { readonly kind: 'connected'; readonly since: number }
  | { readonly kind: 'reconnecting'; readonly attempt: number; readonly nextRetryMs: number }
  | { readonly kind: 'closed'; readonly code: CloseCode; readonly reason: string };

/** The single seam through which every component obtains market data. */
export interface MarketDataSource {
  connect(): Promise<void>;
  disconnect(): void;
  subscribe(symbols: readonly string[]): void;
  unsubscribe(symbols: readonly string[]): void;
  getUniverse(): Promise<SymbolUniverseResponse>;
  getSnapshot(symbol: string): Promise<Snapshot>;
  /** Every price sample recorded for `symbol` since the session began, oldest first —
   * lets a page that opens a symbol mid-session (e.g. noon, for a session that opened
   * at 9:30) render the full session line immediately instead of only the samples that
   * happen to arrive after it starts watching. See client-contract.md's `GET
   * /symbols/{symbol}/history`. */
  getHistory(symbol: string): Promise<SymbolHistoryResponse>;
  readonly on: {
    /** Every raw tick, uncoalesced — the delayed tape itself is never coalesced (NFR-3.1
     * applies only to the display path via `TickDispatcher`/`store`). */
    tick(h: (t: Tick) => void): () => void;
    snapshot(h: (s: Snapshot) => void): () => void;
    status(h: (s: ConnectionState) => void): () => void;
    error(h: (e: ErrorMsg) => void): () => void;
    entitlement(h: (e: EntitlementChanged) => void): () => void;
  };
  /** `null` until the server's `connected` message has arrived. The only way any
   * component learns whether it is on LIVE or DELAYED. */
  readonly identity: () => Identity | null;
  /**
   * The current `ConnectionState`, read synchronously. Optional: `getSharedSource()`
   * (`config.ts`) connects a source before any component has had a chance to register
   * an `on.status` handler, so a subscriber-only view of status misses the initial
   * `connecting`/`connected` transition — `ConnectionStatus` (task 07) needs a way to
   * read "what is it right now" on mount, not just "what changes from here". Declared
   * optional so an implementation that has not added it yet (or never will) still
   * satisfies `MarketDataSource`; a caller should treat a missing `connectionState`
   * the same as an unknown/not-yet-reported state. `SimulatedSource` implements it.
   */
  readonly connectionState?: () => ConnectionState;
}
