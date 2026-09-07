# Phase 2 — Mock Exchange

> Canonical plan for Phase 2 of Tckr. Read this before opening any task file.
> Parent document: [`../MASTER CONTEXT.md`](../MASTER%20CONTEXT.md)

---

## 1. Problem Definition

Tckr's entire architecture starts from one assumption:

```text
                    Stock Exchange
                         │
                 Single Market Feed
                         │
                    25,000 events/sec
                         │
                         ▼
                   Feed Ingestion
```

We do not have access to a real exchange. Before we can build ingestion (Phase 3),
benchmark it (Phase 4), or prove anything downstream, we need a **credible source of
load** that behaves like an exchange rather than like a friendly test fixture.

Phase 2 builds that source: `Tckr.MockExchange`.

The mock exchange must be adversarial in the ways a real exchange is adversarial:

- It streams over **one connection**, in an **exchange-specific wire format** that is
  deliberately *not* our internal event model.
- It sustains **~25,000 events/sec** and does not slow down because a consumer is slow.
- It produces **non-uniform symbol distribution** — a few symbols dominate the tape.
- It has **market phases** — opening and closing bursts, a midday lull.
- It **drops or disconnects** a consumer that cannot keep up, rather than buffering forever.

If the mock exchange is too polite, every measurement taken downstream is worthless.

---

## 2. Why This Is Not Trivial

The naive version of this component is fifteen lines:

```csharp
while (true)
{
    await stream.WriteAsync(RandomTick());
    await Task.Delay(1);
}
```

That version fails Phase 2 for four separate reasons:

| Problem | Consequence |
|---|---|
| `Task.Delay(1)` has millisecond-plus granularity and drifts | Cannot hit 25K/sec, and the achieved rate is unknown |
| One `WriteAsync` per event | Syscall per 40 bytes; throughput collapses long before 25K |
| Allocation per event | GC pressure that pollutes every downstream latency measurement |
| Unbounded write buffering | A slow consumer silently turns into exchange-side memory growth |

Phase 2's real deliverable is therefore not "a thing that emits prices". It is
**a load source whose achieved rate we can trust**, because Phase 4 onward compares
every measurement against it.

---

## 3. Scope

### In scope

- A `Tckr.MockExchange` worker process that listens on TCP and streams market data.
- A binary, length-prefixed, exchange-specific wire protocol.
- A realistic symbol universe with skewed (Zipf-like) activity distribution.
- Seedable, reproducible price/quote generation with per-symbol state.
- A rate governor that hits a configured events/sec target accurately.
- Market session phases with rate multipliers (pre-open, auctions, lull, close).
- Bounded per-session buffering with an explicit slow-consumer policy.
- Metrics and structured logging for generated / published / dropped counts.
- A verification client (`Tckr.FeedProbe`) that decodes the feed, checks sequence
  continuity, and measures achieved throughput.
- A benchmark report with **measured** numbers.

### Out of scope (deliberately)

- Kafka, Redis, WebSockets, authentication — later phases.
- Order book depth, order entry, execution reports, market-by-order.
- Real exchange protocols (FIX, ITCH, OUCH). We *imitate the shape*, not the standard.
- Multicast / UDP. The master context assumes a single TCP feed.
- Historical replay from captured data. Possible later; not needed to prove throughput.

---

## 4. Component Design

```text
                    ┌──────────────────────────────────────────────┐
                    │              Tckr.MockExchange               │
                    │                                              │
   symbols.json ───▶│  SymbolUniverse ──▶ WeightedSymbolPicker     │
                    │        │                     │               │
                    │        ▼                     ▼               │
                    │  SymbolState[]  ◀──── RandomWalkGenerator    │
                    │                              │               │
                    │                              │ FeedRecord    │
                    │                              ▼               │
                    │  MarketSession ──▶ RateGovernor ──▶ batch    │
                    │  (phase × rate)              │               │
                    │                              ▼               │
                    │                      FeedFrameWriter         │
                    │                              │ bytes         │
                    │                              ▼               │
                    │  FeedServer ──▶ FeedSession (bounded buffer) │
                    │                              │               │
                    └──────────────────────────────┼───────────────┘
                                                   │ TCP
                                                   ▼
                                        Tckr.MarketData.Ingestion
                                        (Phase 3)  /  Tckr.FeedProbe
```

### Key design decisions

These are settled. Do not re-litigate them inside a task; if you believe one is wrong,
raise it in the task's *Notes* section and keep building.

1. **TCP, not HTTP/WebSocket/gRPC.** The master context specifies a single TCP feed.
   It also forces Phase 3 to implement real framing and reconnection logic.
2. **Binary, fixed-layout, little-endian records.** Realistic, cheap to encode, and
   sufficiently unlike our internal JSON event model that Phase 3's normalization
   layer has genuine work to do.
3. **Fixed-point prices (`long`, 4 implied decimals).** Never floating point on a
   financial wire. `85.10` travels as `851000`.
4. **The exchange never blocks on a consumer.** Generation runs at its configured rate
   regardless of who is connected or how slow they are. This is the single most
   important behavioural property of the component.
5. **Slow consumers are disconnected, not silently thinned.** Dropping ticks from the
   middle of a sequenced feed is worse than a clean disconnect: the consumer cannot
   tell corruption from silence. `DropOldest` exists as a configurable alternative
   for experiments.
6. **Seedable RNG.** Two runs with the same seed produce the same tape, so benchmark
   comparisons are meaningful.
7. **Batched emission.** Events are generated and flushed in batches (default 5 ms)
   to keep syscall and timer pressure sane at 25K/sec.

---

## 5. Target Repository Layout

```text
src/Tckr.MockExchange/
├── Program.cs                       (task 06)
├── FeedPublisherService.cs          (task 06)  — replaces template Worker.cs
├── Options/
│   ├── MockExchangeOptions.cs       (06)
│   ├── FeedServerOptions.cs         (06)
│   ├── GenerationOptions.cs         (06)
│   └── MarketSessionOptions.cs      (06)
├── Protocol/
│   ├── FeedMessageType.cs           (01)
│   ├── FeedRecord.cs                (01)
│   ├── FeedFrameWriter.cs           (01)
│   ├── FeedFrameReader.cs           (01)
│   └── PriceScale.cs                (01)
├── Reference/
│   ├── SymbolDefinition.cs          (02)
│   ├── SymbolUniverse.cs            (02)
│   ├── WeightedSymbolPicker.cs      (02)
│   └── symbols.json                 (02)
├── Generation/
│   ├── IMarketDataGenerator.cs      (03)
│   ├── RandomWalkGenerator.cs       (03)
│   ├── SymbolState.cs               (03)
│   └── Xoshiro256StarStar.cs        (03)
├── Session/
│   ├── MarketPhase.cs               (04)
│   ├── MarketSessionClock.cs        (04)
│   └── RateGovernor.cs              (04)
├── Feed/
│   ├── FeedServer.cs                (05)
│   ├── FeedSession.cs               (05)
│   └── SlowConsumerPolicy.cs        (05)
└── Diagnostics/
    ├── FeedMetrics.cs               (07)
    └── ThroughputReporter.cs        (07)

tests/Unit/Tckr.MockExchange.Tests/  (01, 02, 03, 04, 05)
tools/Tckr.FeedProbe/                (08)
benchmarks/phase-2/                  (09)
docs/decisions/                      (10)
```

> `tools/` is an addition to the structure suggested in the master context. The probe is
> both a benchmark driver and a day-to-day smoke-test client, so it does not belong under
> `tests/`. Noted in task 10.

---

## 5a. Scaffolding — done

Completed before task 01 so no two agents race to create the same project:

- `tests/Unit/Tckr.MockExchange.Tests` — xUnit, with `Shouldly`,
  `Microsoft.Extensions.TimeProvider.Testing` (`FakeTimeProvider`) and
  `Microsoft.Extensions.Diagnostics.Testing` (`MetricCollector`, `FakeLogger`) referenced,
  `Xunit` and `Shouldly` as global usings, and empty `Protocol/ Reference/ Generation/
  Session/ Feed/ Diagnostics/` folders.
- `tools/Tckr.FeedProbe` — console app with a stub `Program.cs` that exits 3.
- `InternalsVisibleTo` for both, in `Tckr.MockExchange.csproj`.
- Empty area folders under `src/Tckr.MockExchange/`.
- Both projects registered in `src/Tckr.slnx`.
- Template `Worker.cs` deleted; `Program.cs` reduced to a placeholder host that task 06
  replaces.
- A root `.gitignore`.

`dotnet build src/Tckr.slnx` and `dotnet test src/Tckr.slnx` are green. One placeholder test
(`ScaffoldTests.cs`) exists only to keep the suite green — the first task to add real tests
should delete it.

---

## 6. Task Breakdown

Eleven files, ten executable tasks. Each is scoped to be picked up by a single agent
with no knowledge of the others beyond the contracts stated in its brief.

| # | Task | Depends on | Parallelisable with |
|---|---|---|---|
| [01](01-wire-protocol.md) | Feed wire protocol + frame codec | — | 02, 04, 07 |
| [02](02-symbol-universe.md) | Symbol universe + weighted picker | — | 01, 04 |
| [03](03-price-generation.md) | Price/quote generation engine | 01, 02 | 04, 05 |
| [04](04-rate-governor-and-session.md) | Rate governor + market session phases | — | 01, 02, 03, 05 |
| [05](05-tcp-feed-server.md) | TCP feed server + session management | 01 | 03, 04 |
| [06](06-configuration-and-host.md) | Options, DI wiring, publisher loop | 03, 04, 05 | 07 |
| [07](07-metrics-and-logging.md) | Metrics + structured logging | — | 01, 02, 04 |
| [08](08-feed-probe.md) | `Tckr.FeedProbe` verification client | 01, 05 | 06, 07 |
| [09](09-throughput-benchmark.md) | Throughput benchmark + report | 06, 07, 08 | 10 |
| [10](10-adr-and-docs.md) | ADRs + protocol doc + README | 01, 05 | 09 |

### Dependency graph

```text
  Wave 1   01        02        04        07        ← no dependencies
            │         │                   │
            │         │                   │
  Wave 2    ├────┬────┘                   │        03  needs 01, 02
            │    ▼                        │
            │   03                        │
            ├──▶ 05                       │        05  needs 01
            │     │                       │
  Wave 3    └─────┴──────────▶ 06 ◀───────┘        06  needs 03, 04, 05, 07
                   │
  Wave 4           └─────────▶ 08                  08  needs 01, 05
                                │
  Wave 5                        ├──▶ 09            09  needs 06, 07, 08
                                └──▶ 10            10  needs 01, 05 + notes from 08
```

**Wave 1 (fully parallel):** 01, 02, 04, 07 — gate: task 01 reviewed and the byte layout frozen
**Wave 2:** 03, 05
**Wave 3:** 06 (solo — this is the integration point)
**Wave 4:** 08
**Wave 5:** 09, 10

`07` is a pure leaf and moves into wave 1 so that tasks 05 and 06 call real metric methods
rather than a placeholder. `10` runs last on purpose: ADRs 001 and 002 record decisions that
tasks 05 and 08 make, and an ADR written before its decision is a rationalisation.

The critical path is `01 → 05 → 06 → 08 → 09`. Tasks 02, 03, 04 and 07 sit off it — cut from
those first if fewer agents should be in flight.

---

## 7. File Ownership Matrix

Parallel agents must not write the same file. Ownership is exclusive: if a task needs a
change in a file it does not own, it records the request in its *Notes* section and the
owning task applies it.

| Path | Owner |
|---|---|
| `src/Tckr.MockExchange/Protocol/**` | 01 |
| `src/Tckr.MockExchange/Reference/**` | 02 |
| `src/Tckr.MockExchange/Generation/**` | 03 |
| `src/Tckr.MockExchange/Session/**` | 04 |
| `src/Tckr.MockExchange/Feed/**` | 05 |
| `src/Tckr.MockExchange/Options/**` | 06 |
| `src/Tckr.MockExchange/Program.cs` | 06 |
| `src/Tckr.MockExchange/FeedPublisherService.cs` | 06 |
| `src/Tckr.MockExchange/appsettings*.json` | 06 |
| `src/Tckr.MockExchange/Tckr.MockExchange.csproj` | 06 |
| `src/Tckr.MockExchange/Diagnostics/**` | 07 |
| `tools/Tckr.FeedProbe/**` | 08 |
| `benchmarks/phase-2/**` | 09 |
| `docs/decisions/**` | 10 |
| `README.md` (repo root) | 10 |
| `src/Tckr.slnx` | nobody — all Phase 2 projects are already registered |

Tasks 01–05 and 07 each own their own test files under
`tests/Unit/Tckr.MockExchange.Tests/<Area>/`, where `<Area>` matches the source folder they
own. The test **project file** already exists and is treated as append-only — add a package
reference if you genuinely need one, change nothing else.

---

## 8. Conventions

- .NET 10, C# 13, nullable enabled, `ImplicitUsings` enabled (matches existing scaffolds).
- `internal` by default; `public` only where another project genuinely needs it.
- No `float`/`double` for prices or quantities anywhere. Ever.
- Hot-path code (encode, generate, pace, publish) must not allocate per event.
  Use `Span<byte>`, pooled buffers, and pre-sized arrays.
- `async` only where there is real I/O. The generation loop is a dedicated long-running
  loop, not a chain of awaited `Task.Delay` calls.
- Logging: `ILogger<T>` with structured properties, never string interpolation into the
  message template.
- Tests: xUnit + `Shouldly` assertions (add the package in whichever task creates the
  test project first).
- Every task leaves the solution building: `dotnet build src/Tckr.slnx`.

---

## 9. Definition of Done (Phase 2)

Phase 2 is complete when all of the following are **measured**, not assumed:

- [ ] `Tckr.MockExchange` runs as a worker and accepts a TCP feed consumer.
- [ ] Sustains **≥ 25,000 events/sec for 60 seconds**, achieved rate within **±2%** of target.
- [ ] `Tckr.FeedProbe` decodes the stream with **zero sequence gaps** and zero framing errors.
- [ ] Steady-state generation and encoding allocate **0 bytes per event**; no Gen2 collections
      during a 60-second run.
- [ ] Symbol distribution is measurably skewed: top 10 symbols ≥ 50% of the tape.
- [ ] A slow consumer is disconnected under the default policy without affecting the
      generation rate or other sessions.
- [ ] Market phases visibly change the emission rate (opening burst > continuous > lull).
- [ ] Two runs with the same seed produce byte-identical tapes.
- [ ] `benchmarks/phase-2/results.md` records real numbers on named hardware.
- [ ] ADRs exist for the wire format and the slow-consumer policy.

---

## 10. Interview Value

Phase 2 is where several interview answers get their evidence:

- *"How do you know you can handle 25K/sec?"* — because the load source is itself
  measured, and we publish achieved vs. target.
- *"What happens when a consumer is slow?"* — the exchange does not slow down; the
  consumer is disconnected. This is the same principle that later protects exchange
  ingestion from slow WebSocket clients, just one layer earlier.
- *"What about hot symbols?"* — the tape is skewed from day one, so Phase 15 is testing
  a real distribution rather than a uniform one we invented at the end.
- *"How do you get reproducible benchmarks?"* — seeded generation.
