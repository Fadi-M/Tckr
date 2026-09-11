<h1>Tckr</h1>

Tckr is a real-time market-data fan-out system: one exchange connection carrying
~25,000 updates/sec for every symbol, split into a low-latency live path for
subscribed users and a 15-minutes-delayed path for everyone else, delivered to
horizontally scalable WebSocket gateways. It is being built as a structured answer to
a specific system-design interview question — "design the real-time price-update
system between the stock exchange and a Thndr user watching a symbol" — worked all the
way to running, measured code rather than left as a whiteboard sketch. Full framing,
every architectural decision, and the interview narrative the project is built to
demonstrate live in [`docs/MASTER CONTEXT.md`](docs/MASTER%20CONTEXT.md).

## Architecture

```text
                         STOCK EXCHANGE
                              │
                     One market-data feed
                              │
                              ▼
                    ┌──────────────────┐
                    │ Feed Ingestion   │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ Parser / Normalize│
                    └────────┬─────────┘
                             │
                             ▼
                         KAFKA RAW
                             │
                 ┌───────────┴───────────┐
                 │                       │
                 ▼                       ▼
          LIVE BROADCASTER        DELAYED PROCESSOR
                 │                       │
                 │                       │ +15 minutes
                 │                       ▼
                 │                  KAFKA DELAYED
                 │                       │
                 │                       ▼
                 │                DELAYED BROADCASTER
                 │                       │
                 └───────────┬───────────┘
                             │
                       REDIS ROUTING
                             │
              ┌──────────────┴──────────────┐
              │                             │
         LIVE:<symbol>                 DELAYED:<symbol>
              │                             │
       ┌──────┼──────┐               ┌──────┼──────┐
       ▼      ▼      ▼               ▼      ▼      ▼
      GW1    GW2    GWN             GW1    GW2    GWN
              │                             │
       LIVE SUBSCRIBERS              NON-SUBSCRIBERS
```

The governing rule (master context §36): *ingest once, persist the authoritative event
stream, create live and delayed products independently, route by symbol and
entitlement, fan out locally at the gateway, and make all ephemeral gateway state
reconstructable.*

## Status

**Phase 2 of 17 is complete.** Phases 3–17 have not been started.

| Phase | What | Status |
|---|---|---|
| 1 | Define the problem & requirements | Done |
| 2 | Build the mock exchange | **Done** — this repo's only working component |
| 3 | Market data ingestion | Not started |
| 4 | Benchmark ingestion | Not started |
| 5–17 | Kafka, partitioning, auth/entitlements, subscription registry, WebSocket gateways, fan-out, slow clients, snapshots, reconnection, observability, hot-symbol scaling, load test, demo client | Not started |

Full phase-by-phase plan: [`docs/MASTER CONTEXT.md`](docs/MASTER%20CONTEXT.md) (the
implementation plan section, after the design narrative). Phase 2's own plan, task
breakdown and definition of done: [`docs/phase-2-mock-exchange/README.md`](docs/phase-2-mock-exchange/README.md).

### What Phase 2 proves, measured rather than assumed

- `Tckr.MockExchange` sustains its configured rate without slowing down for a slow
  consumer, and disconnects one instead of buffering forever or thinning the tape
  silently — see [ADR 002](docs/decisions/002-slow-consumer-policy.md).
- The generator produces zero-allocation output at **35.9–36.9M events/sec
  single-threaded** (27.1–27.9 ns/event, mean ~36.3M/sec) — measured across 8
  consecutive Release runs of `RandomWalkGeneratorBenchmarkTests
  .GeneratesAtLeastAMillionEventsPerSecondOnOneThread` on an Apple M5 Pro (same
  hardware as `benchmarks/phase-2/raw/env.txt`) — roughly 1,435–1,475x the
  25,000/sec target. Raw run-by-run output:
  `benchmarks/phase-2/raw/generator_throughput/`.
- The formal Phase 2 acceptance benchmark (scenario 3: 3 runs × 60 s, Release build, on
  an Apple M5 Pro / 15 cores / 24 GB RAM, exchange and `Tckr.FeedProbe` co-located on one
  host — see `benchmarks/phase-2/raw/env.txt`) achieved **25,002.92 / 25,001.98 /
  25,001.29 events/sec (100.012% / 100.008% / 100.005% of the 25,000/sec target)** across
  the three runs, with **0 sequence gaps and 0 framing errors** in all three, top-10
  symbol share **59.13%**, delivery latency p50 0.485 ms / p95 0.543 ms / p99 0.559 ms
  (run 1), and **0 Gen0/Gen1/Gen2 collections** across the full 60-second window in every
  run. An independent re-verification run corroborates this: 1,500,250 events over 60 s
  at 25,003/s (+0.012% deviation), 0 gaps, 0 framing errors, top-10 59.1%. Raw data:
  `benchmarks/phase-2/raw/s3_target_25k/run{1,2,3}`.
- Separately, in manual verification runs recorded in
  [`08-feed-probe.md`](docs/phase-2-mock-exchange/08-feed-probe.md) (not the formal
  benchmark harness above), the probe's independently-counted loss under the
  `DropOldest` slow-consumer policy matched the server's own drop log line exactly
  across two runs — evidence the gap-detection contract holds under loss, not a
  throughput claim.
- Full methodology and current numbers: [`benchmarks/phase-2/results.md`](benchmarks/phase-2/results.md).

## Running what exists today

Prerequisites: .NET 10 SDK.

```bash
# Start the mock exchange (listens on :9001 by default)
dotnet run --project src/Tckr.MockExchange

# In another terminal, verify it with the probe
dotnet run --project tools/Tckr.FeedProbe -c Release -- --duration 30
```

Every `MockExchange` setting is overridable by environment variable through the
standard ASP.NET Core double-underscore convention, with no code or config-file change
required — this is how the throughput benchmark sweeps target rates:

```bash
MockExchange__Session__BaseEventsPerSecond=25000 dotnet run --project src/Tckr.MockExchange
```

Run the test suite from the repo root:

```bash
dotnet test src/Tckr.slnx
```

## Repository layout

```text
docs/
├── MASTER CONTEXT.md              full design narrative + 17-phase implementation plan
├── decisions/                     ADRs — the *why* behind settled decisions
└── phase-2-mock-exchange/         Phase 2's plan, ten task briefs, wire protocol reference

src/
├── Tckr.MockExchange/             Phase 2 — done. TCP feed server + generator.
├── Tckr.MarketData.Ingestion/     Phase 3 — scaffolded, not built.
├── Tckr.MarketData.Distribution/  Phase 5+ — scaffolded, not built.
└── Tckr.MarketData.Gateway/       Phase 9+ — scaffolded, not built.

tools/Tckr.FeedProbe/              verification client for the mock exchange's feed
tests/Unit/                        xUnit test suites, one per src project
benchmarks/phase-2/                measured throughput/latency report for Phase 2
client/                            Phase 17 — not built.
```

## Further reading

- [`docs/MASTER CONTEXT.md`](docs/MASTER%20CONTEXT.md) — the full design: requirements,
  architecture, every "why" question the interview raises, and the 17-phase plan.
- [`docs/phase-2-mock-exchange/README.md`](docs/phase-2-mock-exchange/README.md) —
  Phase 2's problem definition, component design and task breakdown.
- [`docs/phase-2-mock-exchange/wire-protocol.md`](docs/phase-2-mock-exchange/wire-protocol.md) —
  the mock exchange's binary wire format, complete enough to write a decoder from.
- [`docs/decisions/`](docs/decisions/) — ADRs recording the decisions made building
  Phase 2 and the reasoning (including one abandoned claim) behind them.
