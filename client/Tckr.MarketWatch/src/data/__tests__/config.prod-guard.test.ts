import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveClientConfig } from '../config.ts';

// Regression coverage for the fail-fast guard in `resolveClientConfig`: a production
// build (`import.meta.env.PROD === true`) must never silently fall back to the
// simulated source just because `VITE_TCKR_SOURCE` was left unset. Vitest itself runs
// with `PROD` false (see the probe in the review notes for this task), so
// `vi.stubEnv('PROD', true)` is the only way to exercise the production branch here
// without an actual `vite build`.
describe('resolveClientConfig — production fail-fast guard', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws when a production build resolves to the simulated source with no override', () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_TCKR_SOURCE', '');
    vi.stubEnv('VITE_TCKR_ALLOW_SIMULATED_IN_PROD', '');

    expect(() => resolveClientConfig()).toThrow(
      /Refusing to run with the simulated data source in a production build/,
    );
  });

  it('does not throw when a production build resolves to the gateway source', () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_TCKR_SOURCE', 'gateway');

    expect(() => resolveClientConfig()).not.toThrow();
  });

  it('does not throw in a production build when VITE_TCKR_ALLOW_SIMULATED_IN_PROD=true', () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_TCKR_SOURCE', '');
    vi.stubEnv('VITE_TCKR_ALLOW_SIMULATED_IN_PROD', 'true');

    const cfg = resolveClientConfig();
    expect(cfg.source).toBe('simulated');
  });

  it('does not throw outside production (dev/test) even with the simulated source', () => {
    // PROD is false under Vitest by default — this is today's behavior and must stay
    // unaffected so the rest of this suite (and `npm run dev`) keeps working.
    vi.stubEnv('VITE_TCKR_SOURCE', '');

    const cfg = resolveClientConfig();
    expect(cfg.source).toBe('simulated');
  });

  it('an explicit gateway override suppresses the guard even if the env resolves to simulated', () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_TCKR_SOURCE', '');

    expect(() => resolveClientConfig({ source: 'gateway' })).not.toThrow();
  });
});
