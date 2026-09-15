/**
 * Fake `uplot` module for `PriceChart` tests. jsdom has no canvas, so the real uPlot
 * constructor cannot run in Vitest — every `chart.*.test.tsx` file replaces the module
 * with this double via `vi.mock('uplot', () => import('./uplotTestDouble.ts')...)`
 * (see each test file). Not itself a `*.test.ts` file, so Vitest does not run it.
 */
import { vi } from 'vitest';

export interface FakeUPlotInstance {
  readonly setData: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
  readonly setSize: ReturnType<typeof vi.fn>;
  readonly redraw: ReturnType<typeof vi.fn>;
  readonly root: HTMLElement;
  cursor: { idx: number | null };
  data: [number[], number[]];
}

export const constructorSpy = vi.fn();
export const instances: FakeUPlotInstance[] = [];

export class FakeUPlot implements FakeUPlotInstance {
  readonly setData = vi.fn();
  readonly destroy = vi.fn();
  readonly setSize = vi.fn();
  readonly redraw = vi.fn();
  readonly root: HTMLElement = document.createElement('div');
  cursor: { idx: number | null } = { idx: null };
  data: [number[], number[]] = [[], []];

  constructor(...args: unknown[]) {
    constructorSpy(...args);
    instances.push(this);
  }
}

/** Resets recorded instances/calls between tests. Does not touch `vi.mock` itself. */
export function resetUplotMock(): void {
  constructorSpy.mockClear();
  instances.length = 0;
}
