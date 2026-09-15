import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarketDataSource, resolveClientConfig } from '../config.ts';
import { SimulatedSource } from '../SimulatedSource.ts';
import { resetStore } from '../store.ts';

describe('createMarketDataSource factory', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to the simulated source when VITE_TCKR_SOURCE is unset', () => {
    vi.stubEnv('VITE_TCKR_SOURCE', '');
    const source = createMarketDataSource();
    expect(source).toBeInstanceOf(SimulatedSource);
  });

  it('yields a MarketDataSource-shaped gateway placeholder for VITE_TCKR_SOURCE=gateway, without constructing a socket', () => {
    const WebSocketSpy = vi.fn();
    vi.stubGlobal('WebSocket', WebSocketSpy);
    vi.stubEnv('VITE_TCKR_SOURCE', 'gateway');

    const source = createMarketDataSource();

    expect(source).not.toBeInstanceOf(SimulatedSource);
    expect(WebSocketSpy).not.toHaveBeenCalled();

    // Structurally a MarketDataSource: every member of the interface is present.
    expect(typeof source.connect).toBe('function');
    expect(typeof source.disconnect).toBe('function');
    expect(typeof source.subscribe).toBe('function');
    expect(typeof source.unsubscribe).toBe('function');
    expect(typeof source.getUniverse).toBe('function');
    expect(typeof source.getSnapshot).toBe('function');
    expect(typeof source.on.tick).toBe('function');
    expect(typeof source.on.snapshot).toBe('function');
    expect(typeof source.on.status).toBe('function');
    expect(typeof source.on.error).toBe('function');
    expect(typeof source.on.entitlement).toBe('function');
    expect(typeof source.identity).toBe('function');
    expect(source.identity()).toBeNull();
  });

  it('an explicit override takes precedence over the environment', () => {
    vi.stubEnv('VITE_TCKR_SOURCE', 'gateway');
    const source = createMarketDataSource({ source: 'simulated' });
    expect(source).toBeInstanceOf(SimulatedSource);
  });

  it('resolveClientConfig applies documented defaults', () => {
    vi.stubEnv('VITE_TCKR_SOURCE', '');
    vi.stubEnv('VITE_TCKR_GATEWAY_URL', '');
    vi.stubEnv('VITE_TCKR_USER', '');
    vi.stubEnv('VITE_TCKR_SIM_RATE', '');
    vi.stubEnv('VITE_TCKR_SIM_DELAY_MS', '');
    vi.stubEnv('VITE_TCKR_SIM_SEED', '');

    const cfg = resolveClientConfig();
    expect(cfg.source).toBe('simulated');
    expect(cfg.gatewayUrl).toBe('ws://localhost:5000');
    expect(cfg.demoUser).toBe('user-001');
    expect(cfg.simulated.eventsPerSecond).toBe(2000);
    expect(cfg.simulated.delayedOffsetMs).toBe(15000);
    expect(cfg.simulated.seed).toBe(20260912);
  });

  it('resolveClientConfig reads every documented env var', () => {
    vi.stubEnv('VITE_TCKR_SOURCE', 'gateway');
    vi.stubEnv('VITE_TCKR_GATEWAY_URL', 'ws://example.test:9000');
    vi.stubEnv('VITE_TCKR_USER', 'user-002');
    vi.stubEnv('VITE_TCKR_SIM_RATE', '500');
    vi.stubEnv('VITE_TCKR_SIM_DELAY_MS', '1500');
    vi.stubEnv('VITE_TCKR_SIM_SEED', '7');

    const cfg = resolveClientConfig();
    expect(cfg.source).toBe('gateway');
    expect(cfg.gatewayUrl).toBe('ws://example.test:9000');
    expect(cfg.demoUser).toBe('user-002');
    expect(cfg.simulated.eventsPerSecond).toBe(500);
    expect(cfg.simulated.delayedOffsetMs).toBe(1500);
    expect(cfg.simulated.seed).toBe(7);
  });
});
