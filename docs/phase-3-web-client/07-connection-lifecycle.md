# Task 07 — Connection Lifecycle, Backoff & Stream Badge

| | |
|---|---|
| **Phase** | 3 — Market Watch Web Client |
| **Status** | Not started |
| **Depends on** | 06 |
| **Blocks** | 09 |
| **Parallel with** | 08 |
| **Owns** | `src/components/StreamBadge.tsx`, `src/components/ConnectionStatus.tsx`, `src/data/reconnect.ts`, their `__tests__/` |

> **Read [`client-contract.md`](client-contract.md) §3.4 and §4 first** — the four
> abnormal close codes and the backoff policy you implement are specified there, and the
> gateway is being built to produce exactly those codes.
>
> **State of the tree when you start:** tasks 01–06 are done; read their *Notes*. Task 03
> exposed `statusSlot` and `badgeSlot` on the header — you mount into them and edit no
> file task 03 owns.
>
> **Ownership note:** `src/data/reconnect.ts` is yours even though `src/data/` is
> otherwise task 02's. It is a pure policy module with no source coupling; task 02 owns
> everything else in that directory.

---

## Where this fits in Phase 3

```text
   data seam (02) ── ConnectionState ──┐        identity() ──┐
                                        ▼                     ▼
                     ┌─────────────── you are here ───────────────┐
                     │  ConnectionStatus       StreamBadge         │
                     │  reconnect.ts (backoff policy)              │
                     └──────────────┬──────────────────────────────┘
                                    │ mounted into
                        app shell header slots (03)
```

Others: **01** types and close codes · **02** the source that emits `ConnectionState` ·
**03** the header slots you fill · **04**/**06** the pages that stay mounted across a
reconnect · **05** the chart that must survive one · **08** the gateway source that will
actually produce these codes over a real socket · **09** the recorded run.

---

## Objective

Make the connection's state legible and its recovery disciplined: a status the user can
read, a stream badge that can only come from the server, and a reconnect policy that does
not stampede a restarting gateway.

---

## Why this matters

**The badge is a security surface.** It is the one place the UI asserts "this data is
live". If it can be set from client state — a prop, a toggle, a URL parameter, a
`useState` default of `'LIVE'` — then the client is choosing its entitlement in the only
way that matters to a user, which is what FR-6 exists to prevent. The value comes from
`identity()`, which comes from the server's `connected` message, and there is no other
path.

**The backoff is an operational surface.** Phase 14 will kill a gateway with clients
attached. Every client reconnecting immediately, in lockstep, is a synchronised stampede
onto a process that has just started — the reconnect storm the master context names
explicitly. Exponential backoff spreads the retries; jitter breaks the lockstep. Without
jitter, backoff alone still produces a thundering herd, because every client doubles on
the same schedule.

---

## Specification

### `reconnect.ts` — pure policy, no I/O

```ts
export interface BackoffPolicy {
  readonly baseMs: number;      // 500
  readonly ceilingMs: number;   // 30_000
  readonly jitter: number;      // 0.2  → ±20%
}
export function nextDelay(attempt: number, policy: BackoffPolicy, rand: () => number): number;
export function shouldReconnect(code: CloseCode): boolean;
```

- `nextDelay(1)` centres on 500ms, `nextDelay(2)` on 1s, doubling to the 30s ceiling;
  each result lies within ±20% of its centre.
- `rand` is injected so tests are deterministic. `Math.random()` is the default only at
  the call site, never inside the policy.
- `shouldReconnect`: `4401` (unauthenticated) → **no** — reconnecting with the same bad
  token loops forever. `4403` (expired) → yes, after re-authentication. `4408`
  (heartbeat timeout) and `4429` (slow consumer) → yes. `1000` → no.

### `ConnectionStatus.tsx`

Renders `ConnectionState` from task 02, one visible state per kind:

| State | Shows |
|---|---|
| `connecting` | "Connecting…" |
| `connected` | "Connected", with the elapsed session time |
| `reconnecting` | "Reconnecting in Ns (attempt N)", counting down |
| `closed` | the reason, mapped from the close code |

Close-code messages, each distinct and each actionable:

| Code | Message |
|---|---|
| `4401` | "Not authenticated — sign in again" (no auto-retry) |
| `4403` | "Session expired — reconnecting" |
| `4408` | "Connection timed out — reconnecting" |
| `4429` | "Disconnected: this client fell behind. Try watching fewer symbols." |
| `1000` | "Disconnected" |

`4429` is the client-facing half of the exchange's slow-consumer policy (ADR 002) and must
name the remedy, not just the fault.

### `StreamBadge.tsx`

```tsx
export function StreamBadge(): JSX.Element | null;   // no props — that is the point
```

- Reads `identity()` from the source. Renders `● LIVE` or `● DELAYED`, or nothing before
  `connected` arrives.
- **No props, no setter, no client-side default.** A badge that renders `LIVE` while
  `identity()` is `null` is a defect, not a loading state.
- On `entitlementChanged`, re-renders to the new stream and triggers the discard described
  below.
- DELAYED shows the delay context ("15 min behind"; in Phase 3, the simulated offset,
  labelled as simulated).
- Distinguishable without colour — LIVE and DELAYED differ in text, not just hue.

### Entitlement transition

When `entitlementChanged` arrives, buffered ticks from the previous stream are discarded
before any new-stream tick renders. **Mixing LIVE and DELAYED data in one view is the
correctness failure the whole system exists to prevent** — a chart that carries three
delayed points into a live series is exactly that failure, at the last mile.

Coordinate the discard with task 02's store (a `resetStream()` call or equivalent); if the
store has no such hook, request it in *Notes* rather than reaching into its internals.

### Heartbeat timeout

Two consecutive missed heartbeats (using `heartbeatIntervalMs` from the `connected`
message) mean the connection is dead: close it locally with `4408` and reconnect through
the policy. Do not wait for the socket's own timeout, which can be minutes.

---

## Inputs you can rely on

From task 01:

```ts
export const CloseCode = { Normal: 1000, Unauthenticated: 4401, TokenExpired: 4403,
                           HeartbeatTimeout: 4408, SlowConsumer: 4429 } as const;
export interface EntitlementChanged { v: 1; type: 'entitlementChanged'; stream: Stream;
  resubscribeRequired: boolean; effectiveFrom: IsoUtc }
```

From task 02:

```ts
export type ConnectionState =
  | { kind: 'connecting'; attempt: number }
  | { kind: 'connected'; since: number }
  | { kind: 'reconnecting'; attempt: number; nextRetryMs: number }
  | { kind: 'closed'; code: CloseCode; reason: string };
export interface Identity { userId: string; stream: Stream; sessionId: string }
// source.on.status(h) · source.on.entitlement(h) · source.identity()
```

From task 03: `statusSlot` and `badgeSlot` on the header, and the theme tokens.

---

## Constraints

- `StreamBadge` takes no props and has no setter; the stream comes only from `identity()`.
- Backoff is deterministic under an injected `rand`; no `Math.random()` inside the policy.
- No component imports a concrete source.
- Every close code maps to a distinct, actionable message.
- Old-stream data is discarded on an entitlement change before new-stream data renders.

## Out of scope

The WebSocket itself (task 08 owns the transport; you own the policy it calls), the pages,
the chart, authentication.

---

## Tests

| Test | Asserts |
|---|---|
| `reconnect.backoff.test.ts` | across 10 attempts with `rand = () => 0.5`, delays are exactly 500, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000 ms |
| `reconnect.jitter.test.ts` | with `rand` at 0 and 1, attempt 3's delay spans exactly [1600, 2400] ms and never leaves ±20% |
| `reconnect.should.test.ts` | `4401` and `1000` → false; `4403`, `4408`, `4429` → true |
| `status.close-codes.test.tsx` | each of the five codes renders a distinct message; `4429`'s names the remedy |
| `status.countdown.test.tsx` | `reconnecting` counts down with fake timers and does not re-render more than once per second |
| `badge.no-client-source.test.tsx` | `StreamBadge` accepts no props (`@ts-expect-error` on any), renders nothing when `identity()` is `null`, and renders the server's value otherwise |
| `badge.entitlement-change.test.tsx` | on `entitlementChanged` the badge flips and the store's reset hook is called **before** the first new-stream tick renders |
| `heartbeat.timeout.test.ts` | two missed intervals trigger a local `4408` close and a reconnect; one missed interval does not |

---

## Definition of done

- [ ] `npm run typecheck && npm test` exit 0; the eight test files above exist and pass.
- [ ] `reconnect.backoff.test.ts` asserts the exact ten-value sequence above, not a range.
- [ ] `reconnect.jitter.test.ts` asserts the exact `[1600, 2400]` bounds for attempt 3.
- [ ] `grep -rn "Math.random" src/data/reconnect.ts` returns nothing.
- [ ] `StreamBadge` has an empty props type — `grep -n "StreamBadge(" src/components/StreamBadge.tsx`
      shows no parameter, and the `@ts-expect-error` case in the test compiles as expected.
- [ ] All five close codes render **five distinct strings** — asserted by
      `status.close-codes.test.tsx` comparing a `Set` of the rendered messages against
      size 5; paste the five strings into *Notes*.
- [ ] The entitlement-change discard is asserted by **ordering** (reset before first new
      tick), not by final state.
- [ ] Killing the connection in `npm run dev` (task 02's simulated source exposes a way,
      or add one behind its constructor) shows: status → reconnecting, countdown, recovery
      without a page reload, chart intact. Describe what you observed in *Notes*.

## Verification

```bash
cd client/Tckr.MarketWatch
npm run typecheck && npm test -- "reconnect|status|badge|heartbeat"
npm run dev                              # LIVE badge, connected status
VITE_TCKR_USER=user-002 npm run dev      # DELAYED badge with the simulated-offset label
```

## Notes for other tasks

<!-- Fill in: the store reset hook you needed from task 02, the five close-code strings,
     and what task 08 must call in reconnect.ts when a real socket closes. -->
