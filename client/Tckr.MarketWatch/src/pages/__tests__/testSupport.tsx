/**
 * Shared fixtures and render helpers for `src/pages/__tests__/`. Not itself a
 * `*.test.tsx` file, so Vitest does not run it directly.
 *
 * Every suite here mocks `../../data/config.ts` with its automatic mock
 * (`src/data/__mocks__/config.ts`); the render helpers point its `getSharedSource()` at
 * the fake source a test builds.
 *
 * Two fixture families, for two kinds of test:
 *  - `loadUniverseFixture`/`makeFakeSource`/`renderBoard`: the `StockList.*` suites,
 *    which render the real 34-symbol universe from `public/symbols.json`.
 *  - `comiDefinition`/`cibDefinition`/`universeFixture`/`snapshotFixture`/
 *    `createFakeSource`/`renderDetail`: the `StockDetail.*` suites, which only need one
 *    or two hand-built symbols.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { act, render, screen, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { vi } from 'vitest';
import { toDecimal } from '../../contracts/decimal.ts';
import { getSharedSource } from '../../data/config.ts';
import { StockList } from '../StockList.tsx';
import type { EntitlementChanged, ErrorMsg, IsoUtc, Tick } from '../../contracts/messages.ts';
import type {
  Snapshot,
  SymbolDefinition,
  SymbolHistoryResponse,
  SymbolUniverseResponse,
} from '../../contracts/rest.ts';
import type { ConnectionState, Identity, MarketDataSource } from '../../data/MarketDataSource.ts';

const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// StockList: the real 34-symbol universe fixture (public/symbols.json)
// ---------------------------------------------------------------------------

interface RawSymbol {
  readonly symbol: string;
  readonly name: string;
  readonly referencePrice: number;
  readonly tickSize: number;
  readonly lotSize: number;
}

function readSymbolsJson(): readonly RawSymbol[] {
  const raw = readFileSync(resolve(here, '../../../public/symbols.json'), 'utf-8');
  return (JSON.parse(raw) as { symbols: readonly RawSymbol[] }).symbols;
}

/** Reads `public/symbols.json` — the byte-identical copy of the exchange's own
 * universe (task 02) — and shapes it as `getUniverse()`'s REST response would. Never
 * a hard-coded list, so this stays correct as the fixture file evolves. */
export function loadUniverseFixture(): readonly SymbolDefinition[] {
  return readSymbolsJson().map((s) => ({
    symbol: s.symbol,
    name: s.name,
    currency: 'EGP',
    tickSize: toDecimal(s.tickSize.toString()),
    lotSize: s.lotSize,
    referencePrice: toDecimal(s.referencePrice.toString()),
  }));
}

export interface StockListFakeSourceOptions {
  /** When provided, the returned source implements `connectionState()` returning
   * this value — read once, synchronously, the way `getSharedSource()` consumers
   * seed their initial state. Omit to exercise a source that hasn't added
   * `connectionState` at all (the property absent, not merely `undefined`-returning). */
  readonly connectionState?: ConnectionState;
  readonly getSnapshotImpl?: (symbol: string) => Promise<Snapshot>;
  readonly getHistoryImpl?: (symbol: string) => Promise<SymbolHistoryResponse>;
}

export interface StockListFakeSourceHandle {
  readonly source: MarketDataSource;
  readonly connect: ReturnType<typeof vi.fn>;
  readonly disconnect: ReturnType<typeof vi.fn>;
  readonly subscribe: ReturnType<typeof vi.fn>;
  readonly unsubscribe: ReturnType<typeof vi.fn>;
  /** Every symbol `getSnapshot` has been called with, in call order. */
  readonly getSnapshotCalls: string[];
  /** Pushes a `ConnectionState` to every handler registered via `source.on.status`. */
  readonly emitStatus: (state: ConnectionState) => void;
}

/**
 * A plain-object `MarketDataSource` fake for `StockList.*` suites: resolves
 * `getUniverse()` with the given symbols; `getSnapshot`/`getHistory` reject with
 * "not used" by default — pass `getSnapshotImpl`/`getHistoryImpl` to exercise a test
 * that does call them (e.g. volume seeding). `connect`/`disconnect`/`subscribe`/
 * `unsubscribe` are always spies so a caller can assert on them directly.
 */
export function makeFakeSource(
  symbols: readonly SymbolDefinition[],
  options: StockListFakeSourceOptions = {},
): StockListFakeSourceHandle {
  const statusHandlers = new Set<(s: ConnectionState) => void>();
  const getSnapshotCalls: string[] = [];
  const connect = vi.fn(() => Promise.resolve());
  const disconnect = vi.fn();
  const subscribe = vi.fn();
  const unsubscribe = vi.fn();
  const defaultReject = () => Promise.reject(new Error('not used'));

  const base: MarketDataSource = {
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    getUniverse: () =>
      Promise.resolve<SymbolUniverseResponse>({
        v: 1,
        asOf: new Date().toISOString() as IsoUtc,
        simulated: true,
        symbols,
      }),
    getSnapshot: (symbol: string) => {
      getSnapshotCalls.push(symbol);
      return (options.getSnapshotImpl ?? defaultReject)(symbol);
    },
    getHistory: (symbol: string) => (options.getHistoryImpl ?? defaultReject)(symbol),
    on: {
      tick: () => () => {},
      snapshot: () => () => {},
      status: (h) => {
        statusHandlers.add(h);
        return () => statusHandlers.delete(h);
      },
      error: () => () => {},
      entitlement: () => () => {},
    },
    identity: () => null,
  };

  const source: MarketDataSource =
    options.connectionState !== undefined
      ? { ...base, connectionState: () => options.connectionState! }
      : base;

  return {
    source,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    getSnapshotCalls,
    emitStatus: (state) => statusHandlers.forEach((h) => h(state)),
  };
}

/** A `Tick`, every field overridable — shared by `StockList.*` and `StockDetail.*`
 * suites alike. A caller always specifies whichever of `s`/`p`/`q` its scenario
 * varies; the rest fall back to a realistic default. */
export function tickFixture(overrides: Partial<Tick> = {}): Tick {
  return {
    v: 1,
    type: 'tick',
    s: 'COMI',
    p: toDecimal('85.75'),
    q: 100,
    k: 'TRADE',
    t: '2026-09-12T10:30:05.000Z' as IsoUtc,
    id: 'evt-000000000000002',
    st: 'LIVE',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// StockDetail: minimal hand-built universe/snapshot/source fixtures
// ---------------------------------------------------------------------------

export function comiDefinition(): SymbolDefinition {
  return {
    symbol: 'COMI',
    name: 'Commercial International Holding',
    currency: 'EGP',
    tickSize: toDecimal('0.05'),
    lotSize: 100,
    referencePrice: toDecimal('85.10'),
  };
}

export function cibDefinition(): SymbolDefinition {
  return {
    symbol: 'CIB',
    name: 'Commercial International Bank',
    currency: 'EGP',
    tickSize: toDecimal('0.05'),
    lotSize: 100,
    referencePrice: toDecimal('70.00'),
  };
}

export interface UniverseFixtureOptions {
  readonly asOf?: IsoUtc;
  readonly symbols?: readonly SymbolDefinition[];
}

/** A minimal `SymbolUniverseResponse` for `StockDetail.*` suites: one symbol (COMI)
 * as of 2026-09-12T09:00:00Z by default. Pass `symbols` for a multi-symbol universe
 * (e.g. the symbol-switch test's COMI + CIB) or `asOf` for a test pinned to a
 * different day (e.g. the market-closed test's 2026-01-15). */
export function universeFixture(options: UniverseFixtureOptions = {}): SymbolUniverseResponse {
  return {
    v: 1,
    asOf: options.asOf ?? ('2026-09-12T09:00:00.000Z' as IsoUtc),
    simulated: true,
    symbols: options.symbols ?? [comiDefinition()],
  };
}

/** A `Snapshot` for `StockDetail.*` suites, every field overridable. */
export function snapshotFixture(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    v: 1,
    symbol: 'COMI',
    stream: 'LIVE',
    price: toDecimal('84.50'),
    change: toDecimal('0.13'),
    changePercent: '+0.15',
    open: toDecimal('84.37'),
    high: toDecimal('84.60'),
    low: toDecimal('84.10'),
    volume: 216637,
    lastEventId: 'evt-000000000000001',
    exchangeTimestamp: '2026-09-12T10:30:00.000Z' as IsoUtc,
    snapshotAge: 0,
    simulated: true,
    ...overrides,
  };
}

export interface CreateFakeSourceOptions {
  /** Defaults to `{userId: 'user-001', stream: 'LIVE', sessionId: 'sess-1'}`; pass
   * `null` or a different `Identity` to exercise a DELAYED/unidentified session. */
  readonly identity?: Identity | null;
  readonly universe?: SymbolUniverseResponse;
  readonly snapshotImpl?: (symbol: string) => Promise<Snapshot>;
  readonly historyImpl?: (symbol: string) => Promise<SymbolHistoryResponse>;
  /** When true, `subscribe`/`unsubscribe` also push a human-readable
   * "subscribe(SYM,SYM)"/"unsubscribe(SYM,SYM)" entry onto the returned handle's
   * `callOrder`, in true call order — for tests asserting strict interleaving (e.g.
   * unsubscribe-before-next-subscribe across a symbol switch). */
  readonly trackCallOrder?: boolean;
}

export interface FakeSourceHandle {
  readonly source: MarketDataSource;
  readonly subscribe: ReturnType<typeof vi.fn>;
  readonly unsubscribe: ReturnType<typeof vi.fn>;
  /** Populated only when `options.trackCallOrder` is set; empty array otherwise. */
  readonly callOrder: string[];
  readonly emitTick: (t: Tick) => void;
  /** Pushes an `EntitlementChanged` event to every handler registered via
   * `source.on.entitlement` — simulates a LIVE↔DELAYED stream switch. */
  readonly emitEntitlement: (e: EntitlementChanged) => void;
}

/**
 * A full fake `MarketDataSource` for `StockDetail.*` suites: a single-symbol (COMI)
 * universe, a LIVE `user-001` identity, and `getSnapshot`/`getHistory` resolving
 * realistic defaults (`snapshotFixture({symbol})` / empty history points) — all
 * overridable via `options`.
 */
export function createFakeSource(options: CreateFakeSourceOptions = {}): FakeSourceHandle {
  const tickHandlers = new Set<(t: Tick) => void>();
  const snapshotHandlers = new Set<(s: Snapshot) => void>();
  const statusHandlers = new Set<(s: ConnectionState) => void>();
  const errorHandlers = new Set<(e: ErrorMsg) => void>();
  const entitlementHandlers = new Set<(e: EntitlementChanged) => void>();
  const identityValue: Identity | null =
    options.identity !== undefined
      ? options.identity
      : { userId: 'user-001', stream: 'LIVE', sessionId: 'sess-1' };
  const defaultSnapshotImpl = (symbol: string) => Promise.resolve(snapshotFixture({ symbol }));
  const defaultHistoryImpl = (symbol: string) =>
    Promise.resolve<SymbolHistoryResponse>({ v: 1, symbol, points: [] });
  const callOrder: string[] = [];

  const subscribe = vi.fn((symbols: readonly string[]) => {
    if (options.trackCallOrder) callOrder.push(`subscribe(${symbols.join(',')})`);
  });
  const unsubscribe = vi.fn((symbols: readonly string[]) => {
    if (options.trackCallOrder) callOrder.push(`unsubscribe(${symbols.join(',')})`);
  });

  const source: MarketDataSource = {
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(),
    subscribe,
    unsubscribe,
    getUniverse: vi.fn(() => Promise.resolve(options.universe ?? universeFixture())),
    getSnapshot: vi.fn((symbol: string) => (options.snapshotImpl ?? defaultSnapshotImpl)(symbol)),
    getHistory: vi.fn((symbol: string) => (options.historyImpl ?? defaultHistoryImpl)(symbol)),
    on: {
      tick: (h) => {
        tickHandlers.add(h);
        return () => tickHandlers.delete(h);
      },
      snapshot: (h) => {
        snapshotHandlers.add(h);
        return () => snapshotHandlers.delete(h);
      },
      status: (h) => {
        statusHandlers.add(h);
        return () => statusHandlers.delete(h);
      },
      error: (h) => {
        errorHandlers.add(h);
        return () => errorHandlers.delete(h);
      },
      entitlement: (h) => {
        entitlementHandlers.add(h);
        return () => entitlementHandlers.delete(h);
      },
    },
    identity: () => identityValue,
  };

  return {
    source,
    subscribe,
    unsubscribe,
    callOrder,
    emitTick: (t) => tickHandlers.forEach((h) => h(t)),
    emitEntitlement: (e) => entitlementHandlers.forEach((h) => h(e)),
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Lets the promise chain a page starts on mount settle (universe, snapshots, history).
 * Works under fake timers, where `findBy*`'s polling would never advance. */
export async function settle(turns = 4): Promise<void> {
  await act(async () => {
    for (let i = 0; i < turns; i += 1) {
      await Promise.resolve();
    }
  });
}

let navigateBack: () => void = () => {};

/** Presses the router's Back, as the browser's button would, from a `renderBoard` page
 * with a symbol open. */
export function pressBack(): void {
  act(() => navigateBack());
}

function DetailStub() {
  const { symbol } = useParams();
  const navigate = useNavigate();
  navigateBack = () => void navigate(-1);
  return <div data-testid="detail-route">{symbol}</div>;
}

export interface RenderBoardOptions {
  /** Defaults to `makeFakeSource(loadUniverseFixture()).source`. */
  readonly source?: MarketDataSource;
  /** The history stack, current entry last. Defaults to `['/']`. */
  readonly history?: readonly string[];
}

/** Renders the board the way `App` mounts it: `StockList` on `/`, with the symbol route
 * nested under it (a stub, `data-testid="detail-route"`, that shows the symbol), then
 * settles the universe fetch. */
export async function renderBoard(options: RenderBoardOptions = {}): Promise<RenderResult> {
  const source = options.source ?? makeFakeSource(loadUniverseFixture()).source;
  const history = options.history ?? ['/'];
  vi.mocked(getSharedSource).mockReturnValue(source);
  const view = render(
    <MemoryRouter initialEntries={[...history]} initialIndex={history.length - 1}>
      <Routes>
        <Route path="/" element={<StockList />}>
          <Route path="EGX/symbols/:symbol" element={<DetailStub />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  await settle();
  return view;
}

/** The board's instrument rows (the header row excluded), in display order. */
export function boardRows(): HTMLElement[] {
  return screen.getAllByRole('row').filter((row) => row.hasAttribute('data-symbol'));
}

export function boardSymbols(): (string | null)[] {
  return boardRows().map((row) => row.getAttribute('data-symbol'));
}

/** Renders a detail page (`<StockDetail symbol=… />`) at `path` against `source`. Pass
 * `settleFirst: false` to inspect the page before its snapshot lands. */
export async function renderDetail(
  page: ReactElement,
  source: MarketDataSource,
  { path = '/', settleFirst = true }: { path?: string; settleFirst?: boolean } = {},
): Promise<RenderResult> {
  vi.mocked(getSharedSource).mockReturnValue(source);
  const view = render(<MemoryRouter initialEntries={[path]}>{page}</MemoryRouter>);
  if (settleFirst) {
    await settle();
  }
  return view;
}
