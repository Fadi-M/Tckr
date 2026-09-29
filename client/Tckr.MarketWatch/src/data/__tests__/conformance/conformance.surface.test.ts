/**
 * `TckrGatewaySource` implements `MarketDataSource` and adds nothing to it; every member
 * it exposes also exists on `SimulatedSource`, so a page can't come to depend on
 * something only one source has.
 *
 * The compile-time half is the `satisfies` below. At runtime, `TckrGatewaySource` keeps
 * all internals `#`-private, so its reflectable surface must be exactly the interface.
 * `SimulatedSource` uses TypeScript `private` (still reflectable) plus test hooks, so it
 * is checked as a superset rather than for equality.
 */
import { describe, expect, it } from 'vitest';
import type { MarketDataSource } from '../../MarketDataSource.ts';
import { SimulatedSource } from '../../SimulatedSource.ts';
import { baseConfig } from '../testSupport.ts';
import { createHarness } from './gatewayHarness.ts';

const INTERFACE_OWN_NAMES = ['connectionState', 'identity', 'on'];
const INTERFACE_METHOD_NAMES = [
  'connect',
  'disconnect',
  'getHistory',
  'getSnapshot',
  'getUniverse',
  'subscribe',
  'unsubscribe',
];

function surface(instance: object): { own: string[]; methods: string[] } {
  return {
    own: Object.keys(instance).sort(),
    methods: Object.getOwnPropertyNames(Object.getPrototypeOf(instance))
      .filter((name) => name !== 'constructor')
      .sort(),
  };
}

describe('TckrGatewaySource public surface', () => {
  it('is exactly MarketDataSource, and every member also exists on SimulatedSource', () => {
    const gateway = createHarness().source satisfies MarketDataSource;
    expect(surface(gateway)).toEqual({ own: INTERFACE_OWN_NAMES, methods: INTERFACE_METHOD_NAMES });

    const simulated = surface(new SimulatedSource(baseConfig()));
    expect(simulated.own).toEqual(expect.arrayContaining(INTERFACE_OWN_NAMES));
    expect(simulated.methods).toEqual(expect.arrayContaining(INTERFACE_METHOD_NAMES));
  });
});
