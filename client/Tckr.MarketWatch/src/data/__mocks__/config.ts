/**
 * Vitest's automatic mock for `../config.ts`: a suite that calls
 * `vi.mock('…/data/config.ts')` with no factory gets this module instead. Page and
 * component suites point `getSharedSource()` at a fake source per test
 * (`vi.mocked(getSharedSource).mockReturnValue(…)`), so no test opens a real source.
 * `resolveClientConfig()` answers with the development defaults (simulated, 15 s delay).
 */
import { vi } from 'vitest';
import type * as Real from '../config.ts';

export const getSharedSource = vi.fn<typeof Real.getSharedSource>();
export const reconnectSharedSource = vi.fn<typeof Real.reconnectSharedSource>();
export const resetSharedSource = vi.fn<typeof Real.resetSharedSource>();
export const createMarketDataSource = vi.fn<typeof Real.createMarketDataSource>();
export const resolveClientConfig = vi.fn<typeof Real.resolveClientConfig>(() => ({
  source: 'simulated',
  gatewayUrl: 'ws://localhost:5000',
  demoUser: 'user-001',
  simulated: { eventsPerSecond: 2000, delayedOffsetMs: 15_000, seed: 1 },
}));
