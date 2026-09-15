# Task 08 — `TckrGatewaySource` & the Contract Conformance Suite

| | |
|---|---|
| **Phase** | 3 — Market Watch Web Client |
| **Status** | Not started |
| **Depends on** | 01, 02 (04 and 06 to reuse their page tests) |
| **Blocks** | 09 |
| **Parallel with** | 07 |
| **Owns** | `src/data/TckrGatewaySource.ts`, `src/data/__tests__/conformance/**`, `src/test-support/FakeWebSocket.ts` |

> **[`client-contract.md`](client-contract.md) is your specification, in full.** Not a
> reference — the specification. Every message, every error code, every close code in it
> is something you implement and prove. If the contract is ambiguous, the ambiguity is a
> finding for *Notes*, not something to resolve by picking one reading silently.
>
> **State of the tree when you start:** tasks 01–06 are done (07 may be in flight). No
> gateway exists and none will until Phase 11 — **you will never run this code against a
> server in this phase.** Fixtures and a fake socket are the whole test surface.

---

## Where this fits in Phase 3

```text
   contracts + fixtures (01) ─────────────┐
                                          ▼
   MarketDataSource (02) ◀──── you implement it a second time
        │                                 │
        │                    ┌─── you are here ────────────────┐
        │                    │  TckrGatewaySource (ws + REST)   │
        │                    │  conformance suite               │
        │                    └──────────────┬──────────────────┘
        ▼                                   │ same page tests, both sources
   SimulatedSource (02) ────────────────────┘
                                            ▼
                            StockList (04) · StockDetail (06) unchanged
```

Others: **01** the types, fixtures and `parseServerMessage` you consume · **02** the
interface you implement and the store you feed · **03** the shell · **04**/**06** the page
tests you re-run against your source · **05** the chart · **07** the backoff policy
(`reconnect.ts`) your socket calls on close · **09** docs.

**This task is the phase's central claim under test.** ADR 006 promises the Phase 18 swap
is one environment variable. Your conformance suite is the only thing that can substantiate
that before a gateway exists.

---

## Objective

Implement the real client-facing contract over WebSocket and REST, and prove — against
fixtures, with no server — that the pages behave identically whichever source is
configured.

---

## Why this matters

The alternative is writing this source in Phase 11, against a running gateway. That
sounds easier and is strictly worse: the source would be written to whatever the gateway
happened to do, and every place the gateway diverged from the contract would be absorbed
silently into client code instead of raising a question. Written now, this file is a
*claim about what the gateway must do* — and Phase 11 either satisfies it or has a bug.

The risk to manage is that untested code written against an absent server is fiction.
That is what the fixtures are for: every message shape, every error code and every close
code is exercised, so this file is as tested as anything else in the phase, just not
integrated. Integration is Phase 18's job and it is explicitly scoped there.

---

## Specification

### `FakeWebSocket.ts`

A test double implementing the browser `WebSocket` surface the source uses
(`readyState`, `send`, `close`, `onopen/onmessage/onerror/onclose` or `addEventListener`).
It records every outbound frame and can be driven from tests:

```ts
export class FakeWebSocket implements Partial<WebSocket> {
  static lastInstance: FakeWebSocket | null;
  readonly sent: string[];
  open(): void;
  emit(message: object | string): void;     // server → client
  serverClose(code: number, reason?: string): void;
  // …WebSocket surface
}
```

### `TckrGatewaySource.ts`

Implements `MarketDataSource` (task 02) exactly. Behaviour, contract section by section:

- **Connect** — opens `${gatewayUrl}/ws/market-data?access_token=<jwt>`. The token comes
  from config; in Phase 3 it is a placeholder string, because authentication is Phase 8.
  Note in *Notes* that the header form (`Authorization: Bearer`) is unavailable to browser
  WebSockets, which is why the contract specifies the query-parameter form.
- **`connected`** — populates `identity()`; nothing is emitted to subscribers before it
  arrives.
- **Subscribe / unsubscribe** — sends `{type:'subscribe',symbols,requestId}`. Correlates
  `subscribed`/`unsubscribed` by `requestId`. Symbols in `rejected` surface as an
  `UNKNOWN_SYMBOL` error, not a silent drop.
- **Ticks** — parsed via `parseServerMessage`, prices through `toDecimal`, pushed to the
  dispatcher. **No coalescing here** — that is the dispatcher's job and it is shared.
- **Snapshot** — `GET /symbols/{symbol}/snapshot`; also accepts unprompted `snapshot`
  frames after a resubscribe (contract §3.3) and routes both through the same handler.
- **Universe** — `GET /symbols`, cached for the session.
- **Heartbeat** — tracks `heartbeatIntervalMs`; two misses → local close `4408` (task 07's
  rule).
- **Close** — consults `shouldReconnect(code)` and `nextDelay(attempt, …)` from
  `reconnect.ts`. On reconnect: re-authenticate, resubscribe every currently-subscribed
  symbol, take snapshots, resume — the contract §4 sequence, in that order.
- **Errors** — every `ErrorCode` surfaces through `on.error`; `RATE_LIMITED` also throttles
  outbound control messages.
- **Forward compatibility** — an unknown field is ignored; an unknown `type` is logged and
  dropped, never thrown into the UI.

### The conformance suite — `src/data/__tests__/conformance/`

Two layers.

**Layer 1 — message conformance.** For every fixture in `contracts/fixtures/`, feed it
through `FakeWebSocket` into `TckrGatewaySource` and assert the resulting interface-level
effect (a tick emitted, identity set, error surfaced, entitlement changed). Driven by
`ALL_SERVER_MESSAGE_TYPES` and `ALL_ERROR_CODES` from task 01, so a message added later
without a conformance case **fails the suite**.

**Layer 2 — source equivalence.** The page-level tests from tasks 04 and 06 re-run against
both sources through one parameterised harness:

```ts
describe.each([
  ['simulated', () => createMarketDataSource({ source: 'simulated', simulated: { seed: 1, ... } })],
  ['gateway',   () => createMarketDataSource({ source: 'gateway' })],   // FakeWebSocket installed
])('%s source', (_name, makeSource) => { /* the same page assertions */ });
```

Do **not** copy tasks 04 and 06's tests. Extract the shared assertions into a helper both
can call, and record the extraction in *Notes* so those owners know their files moved.
Any behaviour that passes for one source and fails for the other is either a contract bug
or a leaked assumption — write it up; do not paper over it with a conditional.

---

## Inputs you can rely on

From task 01: `ServerMessage`, `ClientMessage`, `parseServerMessage`, `CloseCode`,
`ALL_SERVER_MESSAGE_TYPES`, `ALL_ERROR_CODES`, all 20 fixtures, `toDecimal`.

From task 02:

```ts
export interface MarketDataSource { /* see 02; implement every member */ }
export type ConnectionState = /* connecting | connected | reconnecting | closed */;
export function createMarketDataSource(cfg?: Partial<ClientConfig>): MarketDataSource;
export interface ClientConfig { source: 'simulated' | 'gateway'; gatewayUrl: string;
  demoUser: string; simulated: { eventsPerSecond: number; delayedOffsetMs: number; seed: number } }
```

From task 07: `nextDelay`, `shouldReconnect`, `BackoffPolicy` in `src/data/reconnect.ts`.
If task 07 has not landed, implement against these signatures and reconcile at merge.

---

## Constraints

- `TckrGatewaySource` implements `MarketDataSource` with **no** added public members.
- No coalescing, no store writes that bypass the dispatcher — both sources share that path.
- Prices via `toDecimal`; a raw JSON number for a price is a parse error, not a coercion.
- Never send a stream, tier or user field. The outbound serializer accepts only
  `ClientMessage`.
- No network in tests. `FakeWebSocket` and fixtures only; `fetch` is stubbed.

## Out of scope

Running against a real gateway (Phase 18), authentication (Phase 8), server-side anything,
UI. Do not modify tasks 04/06 assertions — extract and reuse them.

---

## Tests

| Test | Asserts |
|---|---|
| `conformance.messages.test.ts` | every `ALL_SERVER_MESSAGE_TYPES` member has a case and produces its documented effect; a deleted case fails the run |
| `conformance.errors.test.ts` | all five `ErrorCode`s surface through `on.error` with code intact; `RATE_LIMITED` throttles outbound control frames |
| `conformance.close-codes.test.ts` | all four abnormal codes produce the right `ConnectionState` and the right `shouldReconnect` decision |
| `conformance.outbound.test.ts` | subscribe/unsubscribe/ping frames match the contract byte-shape; no frame ever contains `stream`, `tier`, `userId` or `delay` |
| `conformance.forward-compat.test.ts` | an unknown field is ignored; an unknown `type` is dropped without throwing |
| `conformance.reconnect-sequence.test.ts` | after a `4408`, the order is authenticate → resubscribe(all) → snapshot → resume, asserted as an ordered call log |
| `conformance.equivalence.test.tsx` | the shared page assertions pass identically against both sources |
| `conformance.snapshot-paths.test.ts` | REST snapshot and unprompted `snapshot` frame reach the UI through the same handler with the same shape |

---

## Definition of done

- [ ] `npm run typecheck && npm test` exit 0; the eight suites above exist and pass.
- [ ] `TckrGatewaySource` implements every member of `MarketDataSource` and adds none —
      a `satisfies MarketDataSource` assertion compiles and the public surface is compared
      against `SimulatedSource`'s in a test.
- [ ] Coverage is derived, not hand-listed: deleting one fixture makes
      `conformance.messages.test.ts` fail. Demonstrate and paste both outcomes into *Notes*.
- [ ] All 5 error codes and all 4 abnormal close codes are exercised.
- [ ] `conformance.equivalence.test.tsx` runs **the same assertions** against both sources
      from one shared helper — no duplicated test bodies, no per-source conditionals. Name
      the helper in *Notes*.
- [ ] Switching source is one environment variable and nothing else:
      `VITE_TCKR_SOURCE=gateway npm run build` succeeds, and
      `grep -rn "SimulatedSource\|TckrGatewaySource" src/ --include=*.tsx` returns nothing.
- [ ] `grep -rn "stream\|tier\|userId" src/data/TckrGatewaySource.ts` shows no occurrence
      on an **outbound** path; list each inbound occurrence in *Notes*.
- [ ] No test opens a real socket or issues a real `fetch` —
      `grep -rn "new WebSocket\|fetch(" src/data/__tests__/` returns nothing outside the
      fake and its stub.
- [ ] Every contract ambiguity you hit is written up in *Notes* as a question for the
      gateway implementer, with the reading you chose. **This list is a deliverable**, not
      a footnote — it is what Phase 11 builds against.

## Verification

```bash
cd client/Tckr.MarketWatch
npm run typecheck && npm test -- conformance
VITE_TCKR_SOURCE=gateway npm run build && echo "gateway build: ok"
grep -rn "SimulatedSource\|TckrGatewaySource" src/ --include=*.tsx
```

## Notes for other tasks

<!-- Fill in: every contract ambiguity and the reading you chose (this is the Phase 11
     hand-off), the shared assertion helper's location, and any interface change task 02
     needs to make both sources fit. -->
