/**
 * reconnect.ts — task 07 (docs/phase-3-web-client/07-connection-lifecycle.md).
 *
 * Pure policy, no I/O. This module computes *what* a reconnect should look like — how
 * long to wait, and whether to retry at all — it never opens a socket, never calls
 * `setTimeout` against the real clock by default, and never reads `Math.random()`
 * itself. A real transport (today: none; from task 08 onward: `TckrGatewaySource`, the
 * only thing that ever actually loses a connection) is expected to call `nextDelay` /
 * `shouldReconnect` from its own retry loop, and `Math.random` is supplied by that call
 * site — never baked in here. This keeps the policy deterministic and testable under
 * fake timers, and keeps `src/data/reconnect.ts` free of any concrete source (see
 * README.md §7/§8 and the ownership note in the task brief: this file lives in
 * `src/data/` but is task 07's, not task 02's).
 *
 * client-contract.md §4: "Reconnect backoff: 500 ms, doubling to a 30 s ceiling, with
 * ±20% jitter so a gateway restart does not produce a synchronised reconnect storm."
 */
import type { CloseCode } from '../contracts/closeCodes.ts';
import { CloseCode as CloseCodeValues } from '../contracts/closeCodes.ts';

export interface BackoffPolicy {
  /** Delay before the first retry, in ms. Contract default: 500. */
  readonly baseMs: number;
  /** The delay never grows past this, in ms. Contract default: 30_000. */
  readonly ceilingMs: number;
  /** Fractional jitter applied symmetrically around the centre delay. Contract
   * default: 0.2 (±20%). */
  readonly jitter: number;
}

/** client-contract.md §4's exact numbers. Callers may supply their own `BackoffPolicy`
 * (e.g. for a test), but this is what production reconnect loops should use. */
export const DEFAULT_BACKOFF_POLICY: BackoffPolicy = {
  baseMs: 500,
  ceilingMs: 30_000,
  jitter: 0.2,
};

/**
 * The delay before reconnect attempt `attempt` (1-indexed: the first retry is attempt
 * 1). Centres on `baseMs * 2^(attempt-1)`, capped at `ceilingMs`, then jittered by
 * ±`jitter` fraction of that centre. `rand` must return a value in `[0, 1)` (the shape
 * of `Math.random()`) — it is always injected here; this function never calls
 * `Math.random()` itself, so the sequence is fully deterministic under test and the
 * real ±20% spread only appears at the real call site, in production.
 *
 * With `rand() === 0.5` every result lands exactly on its centre (500, 1000, 2000,
 * 4000, 8000, 16000, 30000, 30000, ...) because 0.5 is the midpoint of the jitter
 * interval. `rand() === 0` yields the low bound (centre * (1 - jitter)); `rand() === 1`
 * yields the high bound (centre * (1 + jitter)).
 */
export function nextDelay(attempt: number, policy: BackoffPolicy, rand: () => number): number {
  const centre = Math.min(policy.baseMs * 2 ** (attempt - 1), policy.ceilingMs);
  const span = centre * policy.jitter;
  const low = centre - span;
  const high = centre + span;
  return low + rand() * (high - low);
}

/**
 * Whether a closed connection with this code should be retried at all.
 *
 * - `1000` (normal) — client or server closed cleanly; nothing to recover.
 * - `4401` (unauthenticated) — the token was rejected outright. Reconnecting with the
 *   same bad token would loop forever; the client must re-authenticate first, which is
 *   a user action, not a retry.
 * - `4403` (token expired mid-session) — yes, after the client re-authenticates.
 * - `4408` (heartbeat timeout) and `4429` (slow consumer) — transient/operational;
 *   retry with backoff.
 */
export function shouldReconnect(code: CloseCode): boolean {
  switch (code) {
    case CloseCodeValues.Normal:
      return false;
    case CloseCodeValues.Unauthenticated:
      return false;
    case CloseCodeValues.TokenExpired:
      return true;
    case CloseCodeValues.HeartbeatTimeout:
      return true;
    case CloseCodeValues.SlowConsumer:
      return true;
  }
}

// ---------------------------------------------------------------------------------
// Heartbeat watchdog
// ---------------------------------------------------------------------------------
//
// client-contract.md §3.3: "A client that misses two consecutive heartbeats treats the
// connection as dead and reconnects." The task brief assigns this behaviour to task 07
// ("Heartbeat timeout" section) but `MarketDataSource` (task 02/01) currently exposes no
// `on.heartbeat` hook and no `heartbeatIntervalMs` anywhere a component can read it
// (`Identity` carries only `userId`/`stream`/`sessionId`) — see this task's Notes for
// other tasks. This watchdog is the policy half of that requirement, written so a real
// transport (task 08's `TckrGatewaySource`, which does parse real `heartbeat` frames)
// can wire it up directly: call `pulse()` on every received heartbeat (or any liveness
// signal), and treat `onTimeout` firing as "close locally with 4408 and reconnect
// through `nextDelay`/`shouldReconnect`". Timers are injectable so this stays
// deterministic under fake timers and free of a hardcoded `setTimeout`/`Math.random`
// coupling, matching `nextDelay`'s `rand` injection.

export interface HeartbeatTimers {
  readonly setTimeout: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  readonly clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
}

const defaultHeartbeatTimers: HeartbeatTimers = {
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

export interface HeartbeatWatchdog {
  /** Call whenever a heartbeat (or other liveness signal) arrives. Resets the
   * timeout window. */
  pulse(): void;
  /** Stops the watchdog and clears any pending timer. Idempotent. */
  stop(): void;
}

/**
 * Arms a deadline of `2 * heartbeatIntervalMs` from "now" (construction, and every
 * `pulse()` after). If the deadline elapses with no intervening `pulse()` — meaning two
 * consecutive expected heartbeats never arrived — `onTimeout` fires exactly once and the
 * watchdog stops itself. A single missed heartbeat followed by one that arrives late
 * (but before the deadline) resets the window and never fires `onTimeout`.
 */
export function createHeartbeatWatchdog(
  heartbeatIntervalMs: number,
  onTimeout: () => void,
  timers: HeartbeatTimers = defaultHeartbeatTimers,
): HeartbeatWatchdog {
  const deadlineMs = heartbeatIntervalMs * 2;
  let handle: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function arm(): void {
    if (stopped) {
      return;
    }
    if (handle !== undefined) {
      timers.clearTimeout(handle);
    }
    handle = timers.setTimeout(() => {
      handle = undefined;
      stopped = true;
      onTimeout();
    }, deadlineMs);
  }

  arm();

  return {
    pulse(): void {
      arm();
    },
    stop(): void {
      stopped = true;
      if (handle !== undefined) {
        timers.clearTimeout(handle);
        handle = undefined;
      }
    },
  };
}
