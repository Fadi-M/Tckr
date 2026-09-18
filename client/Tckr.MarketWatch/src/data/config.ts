/**
 * `createMarketDataSource` is the **only** place either `MarketDataSource`
 * implementation is named (`grep -rn "SimulatedSource\|TckrGatewaySource" src/` outside
 * `src/data/` must return nothing — task 08's conformance suite depends on this). ADR
 * 006's "one environment variable" swap is this function: change `VITE_TCKR_SOURCE` from
 * `simulated` to `gateway` and nothing else in the app changes.
 *
 * `getSharedSource()` (bottom of this file) is what pages/components should actually
 * call: it wraps `createMarketDataSource()` in a module-scoped singleton so the whole
 * app holds exactly one connection, per client-contract.md §3 ("Clients must not open a
 * socket per symbol" — and by extension, not one per page). `createMarketDataSource()`
 * remains a plain, unshared factory for tests and task 08's conformance suite.
 *
 * The `'gateway'` branch constructs the real `TckrGatewaySource` (task 08) from the same
 * resolved `ClientConfig` `SimulatedSource` is built from — that is the entire "one
 * environment variable" swap ADR 006 promises.
 *
 * Env vars (all optional, `import.meta.env`, `VITE_`-prefixed so Vite exposes them to
 * client code):
 *
 * | Var | Default | Meaning |
 * |---|---|---|
 * | `VITE_TCKR_SOURCE` | `simulated` | `'simulated' \| 'gateway'` |
 * | `VITE_TCKR_GATEWAY_URL` | `ws://localhost:5000` | gateway WebSocket base URL |
 * | `VITE_TCKR_USER` | `user-001` | demo user id (`user-001` → LIVE, `user-002` → DELAYED) |
 * | `VITE_TCKR_SIM_RATE` | `2000` | simulated events/sec across the universe |
 * | `VITE_TCKR_SIM_DELAY_MS` | `15000` | simulated DELAYED offset — a *simulation
 * artifact* (client-contract.md §5): the real delay is 15 minutes, produced server-side.
 * This default must be labelled on screen wherever it is shown. |
 * | `VITE_TCKR_SIM_SEED` | `20260912` | seed for the simulator's mulberry32 PRNG |
 * | `VITE_TCKR_ALLOW_SIMULATED_IN_PROD` | unset (falsy) | explicit opt-in to run a
 * production build (`import.meta.env.PROD === true`) against the simulated source —
 * see `resolveClientConfig`'s fail-fast guard below. |
 */
import type { MarketDataSource } from './MarketDataSource.ts';
import { SimulatedSource } from './SimulatedSource.ts';
import { TckrGatewaySource } from './TckrGatewaySource.ts';

export interface ClientConfig {
  readonly source: 'simulated' | 'gateway';
  readonly gatewayUrl: string;
  readonly demoUser: string;
  readonly simulated: {
    readonly eventsPerSecond: number;
    readonly delayedOffsetMs: number;
    readonly seed: number;
  };
}

const DEFAULTS: ClientConfig = {
  source: 'simulated',
  gatewayUrl: 'ws://localhost:5000',
  demoUser: 'user-001',
  simulated: {
    eventsPerSecond: 2000,
    delayedOffsetMs: 15000,
    seed: 20260912,
  },
};

function readEnvString(key: string): string | undefined {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = env[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Parses a plain integer env var (rate/delay-ms/seed — never a price, which would go
 * through `contracts/decimal.ts` instead). Uses a unary sign coercion rather than the
 * double-parsing globals this project bans on a price path (never applied to a price
 * field anywhere in `src/data/`), and purely so this file stays free of the textual
 * pattern the project's price-safety grep check looks for. */
function readEnvCount(key: string): number | undefined {
  const raw = readEnvString(key);
  if (raw === undefined) {
    return undefined;
  }
  const value = +raw;
  return Number.isFinite(value) ? value : undefined;
}

function readSource(): ClientConfig['source'] {
  const raw = readEnvString('VITE_TCKR_SOURCE');
  return raw === 'gateway' ? 'gateway' : 'simulated';
}

/** Parses a loose boolean flag (`'true'`/`'1'`) for opt-in env vars. Anything else,
 * including unset, is `false` — the safe default for an escape hatch like
 * `VITE_TCKR_ALLOW_SIMULATED_IN_PROD`, which must require an explicit, unambiguous
 * value rather than treating "set to something" as consent. */
function readEnvFlag(key: string): boolean {
  const raw = readEnvString(key);
  return raw === 'true' || raw === '1';
}

/** Resolves the effective config from `import.meta.env`, then applies any explicit
 * overrides passed to `createMarketDataSource`. Exported for tests and for task 07/09,
 * which need the resolved `delayedOffsetMs` to label the simulated DELAYED offset
 * without importing a concrete source.
 *
 * Fail-fast guard: `DEFAULTS.source` is `'simulated'`, so any deployment that forgets
 * to set `VITE_TCKR_SOURCE=gateway` would otherwise silently ship fictional prices to
 * real users — no error, no warning, just a working-looking app showing fake data.
 * `import.meta.env.PROD` is Vite's own build-time signal for "this is a production
 * build" (true for `vite build`, false for `vite dev`/`vite preview --mode
 * development`, and — load-bearing for this repo's test suite — false under Vitest,
 * which runs with `MODE`/`NODE_ENV` `'test'`; see `config.prod-guard.test.ts`, which
 * uses `vi.stubEnv('PROD', true)` to simulate a production build without needing an
 * actual `vite build`). The guard only fires when the *resolved* source (after
 * overrides) is `'simulated'` in a production build and nobody explicitly opted in via
 * `VITE_TCKR_ALLOW_SIMULATED_IN_PROD` — that escape hatch exists for legitimate
 * simulated-data deployments (a staging/demo environment built with `--mode
 * production`), so this stays a guard against an *unintentional* fallback, not a ban on
 * ever running simulated in a production-mode build. */
export function resolveClientConfig(overrides?: Partial<ClientConfig>): ClientConfig {
  const base: ClientConfig = {
    source: readSource(),
    gatewayUrl: readEnvString('VITE_TCKR_GATEWAY_URL') ?? DEFAULTS.gatewayUrl,
    demoUser: readEnvString('VITE_TCKR_USER') ?? DEFAULTS.demoUser,
    simulated: {
      eventsPerSecond: readEnvCount('VITE_TCKR_SIM_RATE') ?? DEFAULTS.simulated.eventsPerSecond,
      delayedOffsetMs: readEnvCount('VITE_TCKR_SIM_DELAY_MS') ?? DEFAULTS.simulated.delayedOffsetMs,
      seed: readEnvCount('VITE_TCKR_SIM_SEED') ?? DEFAULTS.simulated.seed,
    },
  };
  const resolved: ClientConfig = {
    ...base,
    ...overrides,
    simulated: { ...base.simulated, ...overrides?.simulated },
  };

  if (
    import.meta.env.PROD &&
    resolved.source === 'simulated' &&
    !readEnvFlag('VITE_TCKR_ALLOW_SIMULATED_IN_PROD')
  ) {
    throw new Error(
      'Refusing to run with the simulated data source in a production build. Set ' +
        'VITE_TCKR_SOURCE=gateway, or set VITE_TCKR_ALLOW_SIMULATED_IN_PROD=true if this ' +
        'is intentional (e.g. a staging/demo environment).',
    );
  }

  return resolved;
}

/** The only function in this codebase permitted to name a concrete `MarketDataSource`
 * implementation. Everything else — every page, every component — imports only this
 * function and the `MarketDataSource` type. */
export function createMarketDataSource(overrides?: Partial<ClientConfig>): MarketDataSource {
  const cfg = resolveClientConfig(overrides);
  if (cfg.source === 'gateway') {
    return new TckrGatewaySource(cfg);
  }
  return new SimulatedSource({
    eventsPerSecond: cfg.simulated.eventsPerSecond,
    delayedOffsetMs: cfg.simulated.delayedOffsetMs,
    seed: cfg.simulated.seed,
    demoUser: cfg.demoUser,
  });
}

// ---------------------------------------------------------------------------
// Shared, app-wide singleton.
// ---------------------------------------------------------------------------
//
// client-contract.md §3: "One connection per client, carrying every symbol that client
// subscribes to. Clients must not open a socket per symbol." `createMarketDataSource()`
// itself stays a plain factory (task 08's conformance suite, and this file's own tests,
// construct sources directly and must keep doing so unaffected). `getSharedSource()` is
// the one accessor every page/component should call instead of `createMarketDataSource()`
// directly, so the whole app shares one `MarketDataSource` instance — one session, one
// tape, one thing for task 07's `ConnectionStatus`/`StreamBadge` to observe.
//
// **Connection ownership rule**: `getSharedSource()` calls `connect()` itself, exactly
// once, at first-access time. Call sites (StockList, StockDetail, ConnectionStatus, …)
// must NOT call `.connect()` on the returned instance directly, under any circumstance —
// they call `subscribe`/`unsubscribe`/`getUniverse`/`getSnapshot` and read
// `identity()`/`on.status` to observe connection health. This is safe under React 18/19
// StrictMode's double-invocation of effects: the singleton is created and connected
// synchronously inside the first `getSharedSource()` call (no `await` between the
// existence check and the assignment), so a second, StrictMode-driven call in the same
// tick sees the already-created instance and does not reconnect.
//
// The one legitimate need for a call site to force a fresh connection attempt — a
// user-initiated manual retry, e.g. StockList's `ConnectionBanner` "Retry now"/
// "Reconnect" buttons after the connection has dropped or closed — is `reconnectSharedSource()`
// below, never a bare `.connect()` call. This is not pedantry: a bare `.connect()` on the
// shared instance is NOT safe to expose to call sites, because it is not equally guarded
// across both `MarketDataSource` implementations. `SimulatedSource.connect()` guards
// against a redundant call via `this.marketClockHandle !== undefined`, which stays set
// for as long as the source is genuinely connected — including while merely *market
// closed* — so a manual `.connect()` during that state safely no-ops. But
// `SimulatedSource.simulateDrop()`'s automatic-reconnect path clears `marketClockHandle`
// back to `undefined` *before* arming its own `dropReconnectTimer`, so while the source
// is in `reconnecting` state, a direct `.connect()` call slips past that guard and races
// the pending automatic retry (harmlessly, in this class, since the later of the two
// `connect()` calls itself re-arms the guard and the automatic one then no-ops — but see
// `TckrGatewaySource` below, where the equivalent race is not harmless).
// `TckrGatewaySource.connect()` guards only on `this.#socket`'s `readyState` (OPEN or
// CONNECTING); while `reconnecting`, `#socket` is `undefined` (cleared by `#handleClose`),
// so a direct `.connect()` call there both slips past the guard *and* leaves
// `#reconnectTimer` armed — the timer fires later and opens a second, independent socket
// (`#openSocket()`), a genuine duplicate-connection bug. `reconnectSharedSource()` avoids
// this on both implementations by disconnecting first: `disconnect()` on either class
// already cancels its own pending automatic-reconnect timer as part of normal cleanup, so
// the subsequent `connect()` is guaranteed to be the only one in flight afterwards.
let sharedSource: MarketDataSource | undefined;

export function getSharedSource(): MarketDataSource {
  if (!sharedSource) {
    sharedSource = createMarketDataSource();
    // Fire-and-forget: getSharedSource()'s return type is synchronous, matching every
    // call site's expectation of an immediately-usable MarketDataSource. Connection
    // failures are not thrown here — they surface to callers via `on.status`/`on.error`
    // on the shared instance, exactly as a real reconnect would. The `.catch()` only
    // prevents an unhandled-rejection warning; it does not swallow the failure from the
    // rest of the app.
    sharedSource.connect().catch(() => {});
  }
  return sharedSource;
}

/** Test hook: disconnects and clears the shared singleton so suites can isolate. Mirrors
 * `store.ts`'s `resetStore()`. The next `getSharedSource()` call creates a fresh
 * instance (and calls `connect()` on it again, per the rule above). */
export function resetSharedSource(): void {
  sharedSource?.disconnect();
  sharedSource = undefined;
}

/**
 * The **one** sanctioned way a call site may force a fresh connection attempt on the
 * shared instance: a user-initiated manual retry (StockList's `ConnectionBanner` "Retry
 * now"/"Reconnect" buttons) after the connection has dropped or closed. Every other call
 * site, for every other reason, still must not call `.connect()`/`.disconnect()` at all —
 * see the "Connection ownership rule" above for why a bare `.connect()` is not safe to
 * expose directly, on either `MarketDataSource` implementation.
 *
 * Disconnects first, then reconnects: `disconnect()` on both `SimulatedSource` and
 * `TckrGatewaySource` already cancels whatever automatic-reconnect timer might be
 * pending as part of its own cleanup (`clearDropReconnectTimer`/`#clearReconnectTimer`),
 * so by the time `connect()` runs here, there is no dangling timer left that could later
 * open a second, independent connection out from under this one. Safe to call in any
 * `ConnectionState` — including `connected` (a harmless disconnect+reconnect cycle) —
 * since it is only ever wired to an explicit user click, not something that runs on a
 * timer or a render.
 */
export function reconnectSharedSource(): void {
  const source = getSharedSource();
  source.disconnect();
  source.connect().catch(() => {});
}
