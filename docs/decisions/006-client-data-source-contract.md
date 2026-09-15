# ADR 006 — The client is built first, against a frozen contract, behind one swappable source

- **Status:** Accepted
- **Date:** 2026-09-12
- **Phase:** 3 — Market Watch Web Client
- **Deciders:** Coordinator Fadi Matta

## Context

The original plan built the demo client last, as phase seventeen of seventeen. That
ordering has a specific failure mode: by the time the client is written, the gateway
already exists, so the client is written to whatever the gateway happens to do. The
client-facing contract is then not designed — it is the residue of sixteen phases of
server-side decisions, discovered rather than chosen, and the first person to find its
sharp edges is the last person in the pipeline.

Meanwhile the project's most important product distinction — LIVE versus DELAYED market
data for two customer types — is invisible for the entire build. Nothing demonstrates
it until the end. That is at odds with the master context's own rule that every phase
produce something demonstrable.

A new requirement made the question concrete: a web client showing the Egyptian-market
symbol universe as a list, with a per-symbol detail view charting price against time in
real time, which must later switch to real data with no rework.

Three ways to satisfy it:

1. **Leave it last** (the original Phase 17). Contract discovered, not designed; nothing
   demonstrable for sixteen phases.
2. **Build the client now, wired to a throwaway backend.** A thin service reading the
   mock exchange's TCP feed and serving the browser directly would give real generated
   ticks today, but it duplicates what Phase 4 ingestion and Phase 10/11 gateway will do
   properly, and it invites the throwaway to become load-bearing.
3. **Build the client now against a written contract, with a simulated source behind
   the same interface.** Nothing is pre-empted, the contract is designed before any
   server can constrain it, and the swap is a configuration change.

## Decision

**Option 3.** The client becomes Phase 3, pushing every subsequent phase up by one.

- [`docs/phase-3-web-client/client-contract.md`](../phase-3-web-client/client-contract.md)
  is written **before** the client and frozen as v1. It is the interface Phases 8–13
  must serve, not a description of anything that exists.
- All market data reaches the UI through one `MarketDataSource` interface.
  `SimulatedSource` implements it in the browser for Phase 3; `TckrGatewaySource`
  implements the real contract and is written and fixture-tested in Phase 3 even though
  nothing can serve it until Phase 11. Configuration selects one.
- The old "build the demo client" phase becomes **Phase 18 — cut the client over to the
  live system**: the swap, the two-customer side-by-side demo, and a gateway kill test.
- **React 19 + TypeScript + Vite**, not Blazor WebAssembly. Blazor would let the client
  reference the server's C# DTOs directly, which sounds like an advantage and is in fact
  the problem: it would let the contract stay C#-shaped and never prove that it works as
  plain JSON for a non-.NET consumer. A real mobile or web client is not going to share
  our types. The cost is that the TypeScript contract types are a hand-written mirror of
  the C# ones, kept honest by the conformance fixtures in Phase 3 task 08.

## Consequences

**Good**

- The gateway is built to a reviewed contract instead of the contract being back-derived
  from the gateway.
- Something demonstrable exists from Phase 3 rather than Phase 18, including the LIVE vs.
  DELAYED distinction that is the product's whole point.
- The client's security property — the client never chooses its entitlement — is enforced
  in the client's own type system from the start, not retrofitted.
- Contract mistakes are found while they are cheap: changing a JSON shape in Phase 3
  costs a document edit, in Phase 12 it costs a migration.

**Bad, and accepted**

- The TypeScript contract types can drift from the C# ones. Mitigated by fixtures, not
  by tooling; a generated-types step is a reasonable later addition if drift shows up.
- Phase 3's client displays numbers from a browser-side random walk. They are shaped
  like the mock exchange's tape but they are not it, and every screen must say so.
- The 15-minute delay cannot be demonstrated live in a browser session, so `SimulatedSource`
  uses a short labelled offset. This is the one place the Phase 3 client knowingly
  departs from the contract, and it is called out in `client-contract.md` §5.
- Some Phase 3 work will be revisited at the Phase 18 swap — the conformance suite exists
  precisely to keep that to a configuration change, and if it turns out to be more than
  that, the gap is the finding.

**Neutral**

- Phase numbering shifted by one from Phase 3 onward. Documents written during Phase 2
  were updated to the new numbers; git history before 2026-09-12 uses the old ones.

---

## Addendum (task 09, phase close-out) — architecture decisions ratified during the build

Three decisions were made during implementation that were not anticipated at the time
this ADR was accepted. All three were exercised by task 08's conformance suite and
task 09's recorded performance run, and none contradicted the reasoning above — they are
recorded here as the decisions Phase 11 should treat as settled, not as things still open
for debate.

1. **A single shared `MarketDataSource` via `getSharedSource()` (`src/data/config.ts`).**
   It connects itself exactly once, at first access, and **no component may call
   `connect()` or `disconnect()`** on it — a page leaving a route calls `unsubscribe()`
   only. Before this existed, `StockList` and `StockDetail` each built their own source,
   which under a real gateway would have meant two WebSockets per client — a direct
   violation of client-contract.md §3 ("Clients must not open a socket per symbol," read
   here as "not one per page" either). `createMarketDataSource()` itself stays a plain,
   unshared factory for tests and the conformance suite; `getSharedSource()` is what
   every page/component actually calls.
2. **The `entitlementChanged` discard is owned by `store.ts`, not by whichever component
   first observes the event.** `resetStream()` clears every per-symbol view, re-anchors
   each change/change% baseline to the pristine `referencePrice`, and fans out to
   `onStreamDiscard` listeners as one atomic step, strictly after the clearing is done.
   `StreamBadge` triggers it on `entitlementChanged`; `PriceChart` clears its ring buffer
   from the same signal. This is what makes contract §3.3's "never mix LIVE and DELAYED
   in one view" a property of the store rather than something every consumer has to
   remember to implement correctly on its own.
3. **`connectionState()` is optional on `MarketDataSource`**, implemented by both
   `SimulatedSource` and `TckrGatewaySource`, so a component (`ConnectionStatus`) can seed
   its displayed status synchronously on mount instead of inferring "connecting vs.
   connected" from `identity() !== null` and guessing at a `since` timestamp. Declared
   optional so an implementation that never adds it still satisfies the interface; a
   caller treats a missing `connectionState` the same as an unknown/not-yet-reported
   state.

## Addendum (task 09) — contract gaps for the Phase 11 gateway implementer

These surfaced while writing `TckrGatewaySource` (task 08) and `reconnect.ts` (task 07)
against `client-contract.md` — each is a place the contract does not fully specify
gateway behaviour, and the client's own reading of the gap (recorded in source comments
cited below) is what Phase 11 will collide with first if the gateway reads the contract
differently. None of these were resolved by amending the frozen v1 contract; that
decision belongs to whoever owns Phase 11's kickoff, not to this phase.

- **`RATE_LIMITED` specifies no back-off magnitude.** The contract's error table says
  only "back off" (client-contract.md §3.3). The client chose a fixed 2 s window
  (`TckrGatewaySource.ts`, `RATE_LIMIT_BACKOFF_MS = 2000`) to hold outbound control
  frames. If the real gateway expects a different window (or a server-supplied
  `retryAfterMs`), this is silently incompatible rather than loudly rejected.
- **Close codes outside the five defined ones are unspecified.** A real proxy or load
  balancer in front of the gateway can emit `1006` (abnormal closure) or `1001` (going
  away) before the gateway's own logic ever runs. `TckrGatewaySource.ts`'s
  `toCloseCode`/`reconnectDecisionFor` preserve any such code numerically and treat it as
  reconnectable by default (`reconnect.ts`'s `shouldReconnect` is written only for the
  five contract codes and is never asked about anything else). This is a reasonable
  default, not a contract requirement — Phase 11 should decide explicitly rather than
  inherit it by accident.
- **`entitlementChanged.resubscribeRequired` semantics are unclear.** The contract shows
  the field but does not say whether the client must resend `subscribe` frames for the
  affected symbols, or whether it is purely a UI/state discard signal. The client does
  the latter only — `store.resetStream()` clears buffered state and re-renders the
  badge; it never calls `subscribe()` again on its own. If a real gateway expects an
  explicit resubscribe, ticks would silently stop flowing after a stream switch.
- **`ClientConfig` has no JWT/token field.** `client-contract.md` §3.1 describes
  `?access_token=<jwt>`, but nothing issues a real token until Phase 8. The client uses
  the demo user id as the token placeholder (`TckrGatewaySource.ts`'s connection-URL
  construction). This is deliberately a hole shaped like the real thing, not a
  simplification that will need restructuring later.
- **Client-initiated `ping` is defined but never mandated.** The contract lists it as a
  valid client→server message (§3.2) without saying a client must send one.
  `TckrGatewaySource` sends one per `heartbeatIntervalMs` as a liveness probe — an
  implementation choice the client made for its own confidence, not something Phase 11
  can assume every client does.
- **`ConnectionState` has no "never connected yet" variant.** Before the first `connect()`
  call resolves, `connectionState()`/`identity()` report the same shape a genuine
  post-disconnect `closed` state would. This was a judgement call (see `MarketDataSource.ts`'s
  `ConnectionState` doc comment) worth ratifying explicitly rather than leaving implicit.
- **`GET /symbols` ordering is unspecified, and the client depends on it.** The client's
  default list order is whatever order the universe array arrives in — which, from the
  mock exchange's own `symbols.json`, is weight-descending. The contract names no field a
  client could sort by itself. **Phase 11's gateway must preserve weight-descending order
  in `GET /symbols`**, or the default view changes silently the day a real gateway
  replaces the simulator, with no client-side code change to explain why.
- **`MarketDataSource` has no heartbeat surface.** There is no `on.heartbeat` handler and
  no `heartbeatIntervalMs` anywhere on `Identity` — `reconnect.ts`'s
  `createHeartbeatWatchdog` is built and unit-tested (see its module doc) but
  deliberately left **unwired** in both sources, because `SimulatedSource` never sends a
  heartbeat at all and wiring the watchdog to nothing would produce spurious 30 s
  reconnect loops. Phase 11 needs one of these two surfaces added to `MarketDataSource`
  before the watchdog can be switched on for real.

## Addendum (task 09) — known client-side limitations, deliberately accepted

- **`store.ts`'s `applySnapshot`/`applyTick` do not compare `exchangeTimestamp`**, so
  they cannot arbitrate a slow snapshot racing a fast tick that arrived first.
  `StockDetail` therefore keeps its own timestamp-compared state (`mergeTickIntoQuote`)
  instead of reading prices from the shared store for the one symbol it owns. A
  store-level timestamp-aware merge, unifying this with the list page's simpler
  overwrite behaviour, is a reasonable later improvement, not done in this phase.
- **Sorted list views do not live-reorder on every tick.** `StockList` re-sorts only on
  mount, a debounced search, or a sort-column click — deliberate, to avoid a whole-table
  re-render and rows jumping under the user's cursor on every price change.
- **Back navigation does not preserve the list's search/sort state.** Leaving `/` for a
  symbol's detail page and returning resets both.
- **The simulated DELAYED offset is 15 seconds, not 15 minutes** — client-contract.md §5
  names this as the one place the Phase 3 client knowingly departs from the contract, and
  it is labelled as a simulation artifact everywhere it is shown (`StreamBadge`,
  `SimulatedBanner`, `StockDetail`'s DELAYED line).
