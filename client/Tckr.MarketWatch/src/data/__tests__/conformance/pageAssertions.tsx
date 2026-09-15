/**
 * Shared page-level assertions for the Layer 2 "source equivalence" conformance suite
 * (`conformance.equivalence.test.tsx`) — the helper both `describe.each` branches call,
 * so the assertion *bodies* are never duplicated per source (08-gateway-source-
 * conformance.md: "Extract the shared assertions into a helper both can call").
 *
 * `StockList`/`StockDetail` (tasks 04/06) are rendered completely unmodified. What
 * differs between the two `describe.each` branches is only *how a scenario is driven*
 * (a fixture emitted on a `FakeWebSocket` vs. advancing `SimulatedSource`'s internal
 * random-walk timer) — never what is asserted afterwards. That asymmetry is inherent:
 * `SimulatedSource` has no seam for injecting an exact tick, so cross-source parity is
 * expressed as behavioural invariants (loading → a defined price → still a defined
 * price after more data), not byte-identical values. See *Notes* in the task 08 report.
 *
 * No `waitFor`: every scenario runs under `vi.useFakeTimers()`, and Testing Library's
 * `waitFor` polls via the (now fake) `setTimeout` with nothing driving it forward, which
 * deadlocks until the real-clock test timeout fires. Task 06's own
 * `StockDetail.snapshot-first.test.tsx` uses the same fix this file does: the caller
 * advances fake timers inside `act()` first, then these assertions read the DOM
 * synchronously. */
import { expect } from 'vitest';
import { screen } from '@testing-library/react';

/** Asserts the page is still in its initial loading state (used before either source
 * has resolved anything, to prove the "snapshot before stream" ordering is real and
 * not just coincidentally already-settled). */
export function expectDetailLoading(): void {
  expect(screen.getByTestId('stock-detail-loading')).toBeTruthy();
}

/** Asserts the page has painted a defined price and is no longer in the loading state
 * — true for both sources once their respective snapshot has resolved, regardless of
 * the actual numeric value (which only the gateway branch can pin exactly). Call only
 * after the caller has already advanced/flushed that source's clock inside `act()`. */
export function expectDetailShowsAPrice(): void {
  expect(screen.queryByTestId('stock-detail-loading')).toBeNull();
  const priceEl = screen.getByTestId('stock-detail-price');
  expect(priceEl.textContent).toBeTruthy();
}

/** Asserts the not-found state renders for a symbol outside the universe — identical
 * DOM contract for both sources (`StockDetail`'s `unsubscribe`/error path). Call only
 * after the caller has already advanced/flushed that source's clock inside `act()`. */
export function expectDetailNotFound(): void {
  expect(screen.getByTestId('stock-detail-not-found')).toBeTruthy();
}

/** Asserts the list has finished loading and renders a row for the given symbol,
 * without inventing one — same query shape `StockList.universe.test.tsx` (task 04)
 * uses, re-derived here rather than imported since that file is task 04's own
 * `__tests__/` and this suite must not reach into it. Call only after the caller has
 * already advanced/flushed that source's clock inside `act()`. */
export function expectListRowFor(symbol: string): void {
  const rows = screen.getAllByRole('row');
  const match = rows.find((row) => row.getAttribute('data-symbol') === symbol);
  expect(match).toBeDefined();
}
