# PROJECT STATE

> **Every agent and every new session reads this file first.** It is the single
> authoritative answer to *"where is this project right now and what do I do next?"*
>
> Reading order for a cold start:
> 1. This file — current state and next action.
> 2. [`docs/requirements.md`](docs/requirements.md) — what the system must do. Authoritative on requirements.
> 3. [`docs/MASTER CONTEXT.md`](docs/MASTER%20CONTEXT.md) — the design and the 18-phase plan. Authoritative on architecture and rationale; never contradict it.
> 4. The current phase's own plan folder under `docs/` — Phase 4 has none yet; write it
>    first. The frozen [`client-contract.md`](docs/phase-3-web-client/client-contract.md)
>    stays authoritative for everything client-facing and the Phase 11 gateway must serve it.
> 5. [`docs/decisions/`](docs/decisions/) — settled decisions. Do not re-litigate an ADR inside a task; raise it in the task's *Notes* instead.

**Last verified:** 2026-09-12 · commit `7145bd6` (+ uncommitted Phase 3 work) · branch `phase-3-web-client`

---

## 1. Current position

| | |
|---|---|
| **Phases complete** | **1 — Requirements** (with caveats, §7 item 3) · **2 — Mock Exchange** · **3 — Market Watch Web Client** |
| **Current phase** | **Phase 4 — Market Data Ingestion**: not started, no plan folder yet |
| Next after that | Phase 5 — Ingestion benchmark |
| Phases done | 3 of 18 |
| Working components | `Tckr.MockExchange`, `Tckr.FeedProbe`, `client/Tckr.MarketWatch` |
| Scaffold only (template code) | `Tckr.MarketData.Ingestion`, `Tckr.MarketData.Distribution`, `Tckr.MarketData.Gateway` |
| Not present yet | Kafka, Redis, a real WebSocket gateway, auth/entitlement, the delayed stream and its processor, server-side snapshots, observability stack |

```text
Phase:  1 ── 2 ── 3 ──┼── 4 ────┼── 5 ── … ── 17 ── 18
       done done done │ next    │ not started ───────────▶
                      └─ you are ┘
                         here
```

> **Phases were renumbered on 2026-09-12.** The web client was inserted as Phase 3, so
> everything from the old Phase 3 onward moved up by one: ingestion 3→4, benchmark
> 4→5, Kafka 5→6, gateway cluster 9→10, fan-out 10→11 — and the old Phase 17
> "build the demo client" became **Phase 18 — cut the client over to the live system**,
> because the client now exists from Phase 3. Every forward-looking phase reference in
> the docs, ADRs, benchmark report and source comments was updated; **git history before
> 2026-09-12 uses the old numbers.** Rationale:
> [ADR 006](docs/decisions/006-client-data-source-contract.md).

---

## 2. Verified state of the tree

Re-verified by running the commands below on 2026-09-12, not carried over from a prior write-up.

| Check | Command | Result |
|---|---|---|
| Build (.NET) | `dotnet build src/Tckr.slnx` | green |
| Tests (.NET) | `dotnet test src/Tckr.slnx` | **534 passed, 0 failed**, 2 skipped (360+2 MockExchange, 174 FeedProbe) |
| SDK | `dotnet --version` | 10.0.302 |
| Typecheck (client) | `npm run typecheck` | clean (`tsc --noEmit`) |
| Tests (client) | `npm test` | **71 files / 309 tests passed**, 0 failed (4 consecutive runs) |
| Build (client) | `npm run build` | green, 63 modules |
| Build (client, gateway source) | `VITE_TCKR_SOURCE=gateway npm run build` | green — the Phase 11 swap builds today |
| Node / npm | `node --version` / `npm --version` | v24.18.0 / 11.16.0 |

Client commands run from `client/Tckr.MarketWatch`. **No .NET project was touched by
Phase 3** — verified against the session-start `git status`: the modified files under
`src/`, `tests/` and `benchmarks/` are exactly the pre-existing Phase 2 edits, with
nothing added.

The 2 skipped tests are wall-clock benchmarks deliberately gated out of Debug
(`RandomWalkGeneratorBenchmarkTests`, `RateGovernorBenchmarkTests`). Run them with:

```bash
dotnet test src/Tckr.slnx -c Release --filter Category=Benchmark
```

Additionally verified on 2026-09-12 against the raw files rather than the write-ups:
`dotnet test -c Release --filter Category=Benchmark` passes 2/2; the acceptance
benchmark's headline numbers reproduce exactly from `benchmarks/phase-2/raw/s3_target_25k/`
(25,002.92 / 25,001.98 / 25,001.29 events/sec, 0 gaps, 0 framing errors, 0 integrity
violations, top-10 share 59.127%); and summing `dotnet.gc.collections` over all 59
samples of each run gives 0 gen0 / 0 gen1 / 0 gen2.

Working tree: **everything from 2026-09-12 is uncommitted**, and Phase 3's entire output
is untracked — `client/` (the whole client), `docs/requirements.md`,
`docs/phase-3-web-client/`, `docs/decisions/006-*.md` and this file are new;
`docs/MASTER CONTEXT.md`, `README.md`, the Phase 2 docs, the benchmark report and
several source comments are modified by the requirements extraction and the phase
renumbering. **Nothing has been committed** — `git add`/`git commit` were deliberately
withheld from every agent.

---

## 3. What Phase 2 delivered

`Tckr.MockExchange` — a TCP feed server that streams a binary, length-prefixed,
exchange-specific tape, and a `Tckr.FeedProbe` client that independently decodes and
verifies it. Full definition-of-done checklist with per-item evidence:
[`docs/phase-2-mock-exchange/README.md` §9](docs/phase-2-mock-exchange/README.md).
Measured numbers: [`benchmarks/phase-2/results.md`](benchmarks/phase-2/results.md).

Headline measurements (acceptance scenario 3, 3 runs × 60 s, Release, Apple M5 Pro):

- **25,002.92 / 25,001.98 / 25,001.29 events/sec** — 100.005–100.012% of the 25,000/sec target.
- **0 sequence gaps, 0 framing errors** in all three runs.
- **0 Gen0/Gen1/Gen2 collections** across each full 60-second window.
- Top-10 symbol share **59.13%** (skew requirement was ≥ 50%).
- Delivery latency p50 0.485 ms / p95 0.543 ms / p99 0.559 ms (run 1).

Deliberately deferred, **not** a gap in the DoD: benchmark scenario 9 (30-minute soak).
See `benchmarks/phase-2/results.md` §7.

### Run it

```bash
# Terminal 1 — mock exchange, listens on :9001
dotnet run --project src/Tckr.MockExchange

# Terminal 2 — verify the feed
dotnet run --project tools/Tckr.FeedProbe -c Release -- --duration 30

# Any MockExchange setting is overridable by env var (ASP.NET double-underscore convention)
MockExchange__Session__BaseEventsPerSecond=25000 dotnet run --project src/Tckr.MockExchange
```

---

## 4. What Phase 3 delivered

`client/Tckr.MarketWatch` — a React 19 + TypeScript + Vite market-watch client built
against the frozen [`client-contract.md`](docs/phase-3-web-client/client-contract.md),
which no server can serve until Phase 11. All nine task briefs are implemented. Full
DoD with per-item evidence:
[`docs/phase-3-web-client/README.md` §9](docs/phase-3-web-client/README.md).
Measured numbers and the recorded browser run:
[`docs/phase-3-web-client/results.md`](docs/phase-3-web-client/results.md).

The idea the phase turns on, now real:

```text
Phase 3     UI ─▶ MarketDataSource ─▶ SimulatedSource     (browser, no backend)
Phase 11+   UI ─▶ MarketDataSource ─▶ TckrGatewaySource   (real gateway)
                  ^ one interface; VITE_TCKR_SOURCE picks the implementation
```

`VITE_TCKR_SOURCE=gateway npm run build` succeeds **today**, with no change to any file
under `src/pages/`, `src/chart/` or `src/components/` — only `src/data/config.ts`, the
seam itself, branches on the variable.

Headline measurements (all traceable to a file on disk, Phase 2's rule):

- **Render path under a hot symbol:** coalesced flush + `uPlot.setData` cost
  **p95 0.0999 ms** of a 16.7 ms frame budget (~0.6%) at ≈3,777 ticks/sec on one symbol,
  in real Chromium — `client/Tckr.MarketWatch/perf/raw/frame-timing/run{1,2,3}/result.json`.
  Frame rate held at 60.00 fps with zero dropped frames, but **fps is not the load-bearing
  number**: a control run at 250× less load reports the same 60.00 fps, because headless
  Chromium drives a fixed 60 Hz vsync. See `results.md` §3.1.2.
- **Coalescing:** 3,750 ticks/sec into one symbol → `received=225000 flushed=60`,
  **ratio 3750x**, exactly one flush per animation frame (floor was 50x).
- **Ring buffer bounded:** 100,000 pushes into a 600-point buffer → `length === 600`,
  same `Float64Array` references throughout (no reallocation).
- **Render isolation:** a COMI tick re-renders COMI's row `+1`, all other 33 rows `+0`.
- **Reconnect backoff**, 10 drops at `rand=0.5`: 500, 1000, 2000, 4000, 8000, 16000,
  30000, 30000, 30000, 30000 ms — ±20% jitter, 30 s ceiling.
- **Symbol universe:** `public/symbols.json` is **byte-identical** (`cmp`) to
  `src/Tckr.MockExchange/Reference/symbols.json`; no symbol is invented in the client.

Properties enforced structurally, not by convention:

- A price cannot be a JS `number` — branded `DecimalString`, arithmetic only via
  `contracts/decimal.ts`.
- No outbound message can carry `stream`/`tier`/`userId`/`delay` — enforced by the
  `ClientMessage` union **and** by `serializeClientMessage`'s runtime allowlist, so an
  unsafe cast still cannot smuggle one onto the wire (FR-6).
- `StreamBadge` takes zero props; the LIVE/DELAYED value derives only from server
  messages, and there is no client-side entitlement setter.
- **One connection per client** (contract §3) — `getSharedSource()` in `config.ts`
  creates and connects the single source; **no component may call `connect()` or
  `disconnect()`**, a page leaving a route calls `unsubscribe()` only.
- **LIVE and DELAYED data can never mix in one view** (contract §3.3) — `resetStream()`
  clears every per-symbol view, re-anchors each change/change% baseline to the pristine
  `referencePrice`, and fans out to `onStreamDiscard` listeners as one atomic step;
  `PriceChart` clears its ring buffer from it.

### Run it

```bash
cd client/Tckr.MarketWatch
npm ci
npm run dev            # simulated source, no backend needed
npm test               # 71 files / 309 tests
VITE_TCKR_SOURCE=gateway npm run build   # the Phase 11 swap, today
```

The simulated DELAYED offset is **15 seconds, not 15 minutes** — the one place the
Phase 3 client knowingly departs from the contract (contract §5), labelled on screen
wherever shown. The symbol universe is fictional and the client says so (FR-7.4).

---

## 5. Where to continue: Phase 4 — Market Data Ingestion

Target project `src/Tckr.MarketData.Ingestion/`, still the unmodified `dotnet new worker`
template. Scope: the single exchange connection — connect, receive, parse, validate,
normalize, reconnect, measure throughput. No Kafka or Redis yet (Kafka is Phase 6);
Phase 5 benchmarks what Phase 4 builds. Everything needed to write the decoder exists:
the [wire protocol doc](docs/phase-2-mock-exchange/wire-protocol.md),
`FeedFrameReader.cs`, and `tools/Tckr.FeedProbe/ProbeSession.cs` as prior art for
framing, partial reads and gap detection. Whether Ingestion may share `FeedFrameReader`
the way the probe does ([ADR 005](docs/decisions/005-shared-frame-codec-in-probe.md)) is
an open Phase 4 decision — a production ingestion service would not normally take a
source dependency on the exchange simulator. Write `docs/phase-4-ingestion/README.md`
first, as Phase 2 and Phase 3 both did.

---

## 6. Conventions in force

From `docs/phase-2-mock-exchange/README.md` §8; they apply project-wide unless a later
phase brief overrides them.

- .NET 10, C# 13, nullable enabled, `ImplicitUsings` enabled.
- `internal` by default; `public` only where another project genuinely needs it.
- **No `float`/`double` for prices or quantities. Ever.** Fixed-point `long`, 4 implied decimals.
- Hot-path code must not allocate per event — `Span<byte>`, pooled buffers, pre-sized arrays.
- `async` only where there is real I/O; hot loops are dedicated long-running loops, not chained `Task.Delay`.
- `ILogger<T>` with structured properties, never interpolation into the message template.
- Tests: xUnit + Shouldly. Every task leaves `dotnet build src/Tckr.slnx` green.
- Benchmarks publish **achieved vs. target** and cite a raw file on disk. Never a
  remembered or estimated number.
- Parallel agents get exclusive file ownership; a task needing a change in a file it
  does not own records the request in its *Notes* for the owner to apply.

Settled decisions: ADR [001](docs/decisions/001-mock-exchange-wire-protocol.md) wire
protocol · [002](docs/decisions/002-slow-consumer-policy.md) slow-consumer policy ·
[003](docs/decisions/003-symbol-distribution.md) symbol skew ·
[004](docs/decisions/004-deterministic-generation.md) deterministic generation ·
[005](docs/decisions/005-shared-frame-codec-in-probe.md) shared frame codec.

---

## 7. Open items

1. ~~Phase 1 has no `requirements.md`.~~ **Closed 2026-09-12.** The requirements were
   extracted out of `MASTER CONTEXT.md` into [`docs/requirements.md`](docs/requirements.md)
   — Phase 1's named output now exists. The master context keeps architecture and
   rationale, and its §5 points at the new document. Its sections were renumbered as a
   result (old §36 Final Mental Model is now §25); references in `README.md` and this
   file were updated to match. `requirements.md` §8 carries four open questions the
   master context had left implicit — late-event semantics, no numeric latency target,
   duplicate-delivery policy, and internal price serialization.
2. ~~README and master context disagree on framing.~~ **Closed 2026-09-12.** The
   employer name and interview framing are gone from both `README.md` and
   `docs/MASTER CONTEXT.md`. **Still outstanding:** the same framing survives in
   `docs/phase-2-mock-exchange/README.md` §10 ("Interview Value"),
   `docs/phase-2-mock-exchange/10-adr-and-docs.md`, `08-feed-probe.md`, and ADRs
   [001](docs/decisions/001-mock-exchange-wire-protocol.md) and
   [002](docs/decisions/002-slow-consumer-policy.md). Those are historical Phase 2
   records; scrub them or leave them deliberately, but decide rather than drift.
3. **`Microsoft.OpenApi` 2.0.0 in `Tckr.MarketData.Gateway` has a known high-severity
   advisory** (NU1903, GHSA-v5pm-xwqc-g5wc), surfaced on every restore. The Gateway is
   untouched template code until Phase 10; fix it when that project is first built for real.
4. **Benchmark scenario 9 (30-minute soak) never run** — deferred by decision, recorded
   in `benchmarks/phase-2/results.md` §7. The longest window actually tested is 300 s
   (scenario 8). Worth folding into Phase 5 or a later soak/load phase rather than
   leaving permanently undone.
5. **Phase 1's requirements are documented but not all measurable.** The phase asks for
   *measurable* requirements; several have no threshold: **no numeric latency target**
   (so Phase 17's load test has no pass/fail line), no RTO/RPO or availability target for
   fault tolerance, no duplicate-delivery policy, a demo-only late-event policy, and
   capacity sizing resting on an unvalidated ~200 bytes/event estimate (the one measured
   record is 44 bytes). Collected in [`docs/requirements.md`](docs/requirements.md) §8.
   Either set the numbers or amend the phase's claim — the latency budget is the one that
   actually blocks a later phase.
6. **Benchmark scenario 8's three runs are recorded `FAIL` (exit 2).** The runs are
   healthy — 0 gaps, 0 framing errors, phase shape reproduced across all three — but
   `Tckr.FeedProbe` applies a flat ±2% tolerance to a deliberately varying rate. Known and
   documented (`benchmarks/phase-2/results.md` §3.8, §6); the fix, a phase-aware check, was
   left undone. **Any Phase 4/5 tooling reusing the probe against a non-flat rate mode will
   hit this.**
7. **No phase builds the delayed processor.** The 15-minute delayed path — the Kafka
   DELAYED stream and its processor — is in the architecture (§5 FR-4), in the acceptance
   criteria (`requirements.md` §7) and is half the product, but no phase in the plan names
   it as a deliverable. It falls somewhere around Phases 6–7 (Kafka, partitioning) or wants
   a phase of its own. Decide before Phase 6.
8. **One stale `TODO(task-07)`** in `src/Tckr.MockExchange/Feed/IFeedServerMetrics.cs`,
   referring to Phase 2's task numbering. Harmless; delete when that file is next touched.

### Opened by Phase 3 — the contract gaps the client found

These are the phase's real product: a client implemented against `client-contract.md`
fifteen phases before the gateway must serve it. **Phase 11 must resolve items 9–11
before the gateway is built**, or the client changes at the swap and the phase's claim
was false. Full write-ups in
[`docs/phase-3-web-client/results.md`](docs/phase-3-web-client/results.md) and
[ADR 006](docs/decisions/006-client-data-source-contract.md).

9. **`GET /symbols` ordering is unspecified and load-bearing.** The client's default list
   order is the universe array's own order, which is weight-descending in the mock
   exchange's file. The contract defines no field a client could sort by, so **the Phase 11
   gateway must preserve weight-descending order** or the default view silently changes
   with nothing failing. The quietest bug in the set.
10. **`MarketDataSource` has no heartbeat surface** — no `on.heartbeat`, no
    `heartbeatIntervalMs` on `Identity`. `reconnect.ts`'s `createHeartbeatWatchdog` is
    built and unit-tested but deliberately **unwired**, because the simulator never
    heartbeats and wiring it would cause spurious 30 s reconnect loops. Phase 11 must
    expose one of those two surfaces to switch it on. The contract's "a client that misses
    two consecutive heartbeats reconnects" (§3.3) is therefore **not enforced today**.
11. **Under-specified contract behaviour**, each resolved by a client-side judgement call
    that Phase 11 should ratify or overturn: `RATE_LIMITED` names no backoff magnitude
    (client chose a fixed 2 s); close codes outside the defined five (a real proxy emits
    1006/1001) have undefined behaviour (client treats unmapped as reconnectable);
    `entitlementChanged.resubscribeRequired` semantics are unclear (client does not
    auto-resubscribe); `ClientConfig` has no JWT field (client uses the demo user as an
    `?access_token=` placeholder — real issuance is Phase 8); client-initiated `ping` is
    defined but never mandated (client sends one per `heartbeatIntervalMs`);
    `ConnectionState` has no "never connected" variant, so `connectionState()` returns
    `closed`/`Normal`/"not connected yet" before the first connect.
12. **`store.ts` cannot arbitrate a snapshot racing a tick.** `applySnapshot`/`applyTick`
    do not compare `exchangeTimestamp`, so a slow snapshot can overwrite a newer tick.
    `StockDetail` works around this by keeping its own timestamp-compared state instead of
    reading prices from the store — meaning the detail page and the list read through
    different paths. Worth a store-level timestamp-aware merge.
13. **The chart's visible time window collapses under a hot symbol.** A 600-point ring
    buffer at ~3,777 ticks/sec covers a fraction of a second, so the price-vs-time chart
    shows almost no time under load. Found during the recorded run; a real product
    characteristic, not a bug in the buffer. Needs a time-based (not count-based) window
    or a downsampling policy — for task 05's owner or Phase 18.
14. **Accepted client limitations, recorded so they are not rediscovered as bugs:** sorted
    list views do not live-reorder on every tick (deliberate — avoids whole-table renders
    and rows jumping under the cursor); back navigation does not preserve the list's
    search/sort state; `performance.memory` quantizes to 10 MB buckets, so the recorded
    heap delta of 0 is not evidence of no leak.

---

## 8. Maintaining this file

Update it whenever the answer to *"what phase are we on and what's next?"* changes —
at minimum when a phase completes, when an open item is closed, or when the build or
test state changes. Keep it short: it is a pointer to the authoritative documents, not
a copy of them. Every claim here must be checkable by a command or a file path, and
verified when written rather than carried forward on trust.
