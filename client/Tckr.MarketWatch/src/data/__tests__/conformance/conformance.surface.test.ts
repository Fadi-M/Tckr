/**
 * DoD: "`TckrGatewaySource` implements every member of `MarketDataSource` and adds
 * none — a `satisfies MarketDataSource` assertion compiles and the public surface is
 * compared against `SimulatedSource`'s in a test."
 *
 * The compile-time half is the `satisfies MarketDataSource` expression below (this file
 * fails `npm run typecheck` if `TckrGatewaySource` is missing a member or has the wrong
 * shape for one).
 *
 * For the runtime half, note a real asymmetry between the two classes: every internal
 * field/method on `TckrGatewaySource` is a true `#`-private class member, invisible to
 * *any* reflection (`Object.keys`, `Object.getOwnPropertyNames`) — so its reflectable
 * surface is, by construction, exactly the `MarketDataSource` interface. `SimulatedSource`
 * uses TypeScript's `private` keyword instead, which is compile-time-only: its internal
 * fields (`config`, `prng`, `runtimeBySymbol`, …) and helper methods (`generateOne`,
 * `emitStatus`, …) are all still reflectable at runtime, plus one documented,
 * intentional non-interface member (`simulateEntitlementChange`, its own test hook — see
 * that file's module doc). A literal reflectable-surface *equality* between the two
 * classes would therefore never hold regardless of correctness, so the comparison this
 * test actually makes is: (a) `TckrGatewaySource`'s reflectable surface is *exactly* the
 * `MarketDataSource` member names — proving it adds nothing — and (b) every one of those
 * names is also present somewhere on `SimulatedSource` — the literal "compared against
 * SimulatedSource's" cross-check, proving nothing is missing either.
 *
 * One deliberate exception on the (b) side: `connectionState` is `MarketDataSource`'s
 * newest member — an *optional* synchronous "current status" getter task 02 added so a
 * component that subscribes to `on.status` after `getSharedSource()` has already
 * connected does not miss the transition (task 07's finding). It is implemented here as
 * a real, always-present method, per that request, but `SimulatedSource` has not (yet)
 * grown one of its own since the member is optional — so it is excluded from the
 * subset-of-`SimulatedSource` cross-check below, the same way `simulateEntitlementChange`
 * is excluded in the other direction.
 */
import { describe, expect, it } from 'vitest';
import type { MarketDataSource } from '../../MarketDataSource.ts';
import { SimulatedSource } from '../../SimulatedSource.ts';
import { createHarness } from './gatewayHarness.ts';

const INTERFACE_OWN_NAMES = ['on', 'identity', 'connectionState'] as const;
const INTERFACE_METHOD_NAMES = [
  'connect',
  'disconnect',
  'subscribe',
  'unsubscribe',
  'getUniverse',
  'getSnapshot',
] as const;

function ownKeys(instance: object): readonly string[] {
  return Object.keys(instance).sort();
}

function prototypeMethodNames(instance: object): readonly string[] {
  return Object.getOwnPropertyNames(Object.getPrototypeOf(instance))
    .filter((name) => name !== 'constructor')
    .sort();
}

describe('TckrGatewaySource public surface', () => {
  it('is assignable to MarketDataSource (compile-time)', () => {
    const harness = createHarness();
    const asInterface = harness.source satisfies MarketDataSource;
    expect(typeof asInterface.connect).toBe('function');
    // `connectionState` is optional on the interface but implemented here as a real,
    // always-present method (task 07's request) — not merely `undefined`.
    expect(typeof asInterface.connectionState).toBe('function');
  });

  it('reflects exactly the MarketDataSource own members (on, identity, connectionState) — nothing else', () => {
    const gateway = createHarness().source;
    expect(ownKeys(gateway)).toEqual([...INTERFACE_OWN_NAMES].sort());
  });

  it('reflects exactly the MarketDataSource methods on its prototype — nothing else', () => {
    const gateway = createHarness().source;
    expect(prototypeMethodNames(gateway)).toEqual([...INTERFACE_METHOD_NAMES].sort());
  });

  it("every member TckrGatewaySource reflects is also present on SimulatedSource's surface", () => {
    const gateway = createHarness().source;
    const simulated = new SimulatedSource({
      eventsPerSecond: 1000,
      delayedOffsetMs: 1000,
      seed: 1,
      demoUser: 'user-001',
    });
    const simulatedOwn = new Set(ownKeys(simulated));
    const simulatedProto = new Set(prototypeMethodNames(simulated));

    // `connectionState` is optional on `MarketDataSource`; SimulatedSource has not
    // implemented it (yet). See this file's module doc.
    const gatewayOwnToCompare = ownKeys(gateway).filter((name) => name !== 'connectionState');

    for (const name of gatewayOwnToCompare) {
      expect(simulatedOwn.has(name)).toBe(true);
    }
    for (const name of prototypeMethodNames(gateway)) {
      expect(simulatedProto.has(name)).toBe(true);
    }
  });
});
