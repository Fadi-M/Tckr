/**
 * Shared harness for the gateway conformance suite (task 08). Wires a `TckrGatewaySource`
 * to a `FakeWebSocket` (`src/test-support/FakeWebSocket.ts`) and a stubbed `fetchImpl` —
 * no test in this directory opens a real socket or issues a real `fetch`
 * (`grep -rn "new WebSocket\|fetch(" src/data/__tests__/` must find nothing outside this
 * file's own stub wiring).
 */
import { vi } from 'vitest';
import { TckrGatewaySource, type TckrGatewaySourceDeps } from '../../TckrGatewaySource.ts';
import type { ClientConfig } from '../../config.ts';
import { FakeWebSocket } from '../../../test-support/FakeWebSocket.ts';
import { FIXTURES } from '../../../contracts/fixtures/index.ts';

export function baseGatewayConfig(overrides: Partial<ClientConfig> = {}): ClientConfig {
  return {
    source: 'gateway',
    gatewayUrl: 'ws://gateway.test:5000',
    demoUser: 'user-001',
    simulated: { eventsPerSecond: 2000, delayedOffsetMs: 15000, seed: 1 },
    ...overrides,
  };
}

export type FetchResponseLike = { readonly ok: boolean; readonly status: number; json(): Promise<unknown> };

export function jsonResponse(body: unknown, ok = true, status = 200): FetchResponseLike {
  return { ok, status, json: () => Promise.resolve(body) };
}

export interface Harness {
  readonly source: TckrGatewaySource;
  readonly fetchImpl: ReturnType<typeof vi.fn>;
  readonly random: ReturnType<typeof vi.fn>;
  /** The most recently constructed `FakeWebSocket` — the current socket after the
   * initial connect, and the *new* socket once a reconnect has opened one. */
  socket(): FakeWebSocket;
}

/**
 * Builds a `TckrGatewaySource` wired to a fake socket/fetch.
 *
 * @param routes Maps a REST path suffix (matched with `.endsWith`) to the JSON body
 *   `fetchImpl` resolves with. An unmatched path resolves 404 — deterministic failure
 *   instead of a hang for a test that does not expect a particular call.
 * @param configOverrides Overrides on top of `baseGatewayConfig()`.
 * @param depsOverrides Overrides on top of the fake `createSocket`/`fetchImpl`/`random`
 *   (e.g. a test that needs to instrument `createSocket` itself for call-order proof).
 */
export function createHarness(
  routes: Record<string, unknown> = {},
  configOverrides: Partial<ClientConfig> = {},
  depsOverrides: TckrGatewaySourceDeps = {},
): Harness {
  const fetchImpl = vi.fn((url: string) => {
    const match = Object.keys(routes).find((suffix) => url.endsWith(suffix));
    if (match !== undefined) {
      return Promise.resolve(jsonResponse(routes[match]));
    }
    return Promise.resolve(jsonResponse({ error: 'not found' }, false, 404));
  });
  const random = vi.fn(() => 0.5);
  const config = baseGatewayConfig(configOverrides);
  const source = new TckrGatewaySource(config, {
    createSocket: (url) => new FakeWebSocket(url),
    fetchImpl,
    random,
    ...depsOverrides,
  });
  return {
    source,
    fetchImpl,
    random,
    socket: () => {
      const instance = FakeWebSocket.lastInstance;
      if (!instance) {
        throw new Error('createHarness: no FakeWebSocket has been constructed yet');
      }
      return instance;
    },
  };
}

/** Connects `source`, opens the underlying fake socket, and delivers a `connected`
 * frame (defaulting to the `connected-live` fixture) — the state every test beyond the
 * raw handshake itself assumes. Returns the socket for further driving. */
export async function connectAndAuthenticate(
  harness: Pick<Harness, 'source' | 'socket'>,
  connectedFrame: object = FIXTURES['connected-live'],
): Promise<FakeWebSocket> {
  const connectPromise = harness.source.connect();
  const socket = harness.socket();
  socket.open();
  await connectPromise;
  socket.emit(connectedFrame);
  return socket;
}

/** Flushes the microtask queue a few times — enough for a chain of already-resolved
 * promises (no pending timers) to settle, without depending on `vi.advanceTimersByTimeAsync`
 * for purely-microtask continuations. */
export async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}
