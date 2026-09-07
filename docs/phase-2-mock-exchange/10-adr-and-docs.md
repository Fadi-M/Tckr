# Task 10 — Architecture Decision Records & Documentation

| | |
|---|---|
| **Phase** | 2 — Mock Exchange |
| **Status** | Not started |
| **Depends on** | 01, 05 (for the decisions being recorded) |
| **Blocks** | — |
| **Parallel with** | 09 |
| **Owns** | `docs/decisions/**`, `docs/phase-2-mock-exchange/wire-protocol.md`, repo-root `README.md` |

> **Scaffolding is already done.** The test project (`tests/Unit/Tckr.MockExchange.Tests`,
> xUnit + Shouldly + `FakeTimeProvider` + `MetricCollector`), the probe project
> (`tools/Tckr.FeedProbe`), both `InternalsVisibleTo` entries, the empty area folders under
> `src/Tckr.MockExchange/`, and the `src/Tckr.slnx` registrations all exist and build.
> Add your files into the existing structure; do not re-create projects or touch the
> solution file.

---

## Objective

Write down the decisions and the reasoning, so that six weeks from now — in an interview
room — the *why* is recoverable, not reconstructed on the spot.

---

## Why this matters

The master context lists the questions this project exists to answer, and most of them are
"why" questions:

> Why Kafka? Why not RabbitMQ? Why separate live and delayed paths? What exactly does
> "15 minutes delayed" mean?

Phase 2 produces its own set. An ADR written at the moment of the decision captures the
alternatives that were actually considered and the constraints that were actually in play.
An ADR reconstructed later captures a rationalisation. The difference is audible.

`docs/decisions/` already exists and is empty. This task fills it.

---

## Deliverables

### ADR 001 — Binary length-prefixed wire protocol

`docs/decisions/001-mock-exchange-wire-protocol.md`

- **Context:** the exchange feed must be exchange-*like*, not a convenience format, so
  that ingestion has real parsing and normalization work to do.
- **Alternatives:** JSON lines (readable, ~4× the bytes, allocation-heavy to parse);
  Protobuf/Avro (schema evolution, but a dependency and not what exchanges send); a real
  standard such as ITCH or FIX (maximum realism, disproportionate effort, and the
  interview problem is fan-out, not protocol implementation); fixed-layout binary
  (chosen).
- **Decision and the layout**, referencing the spec.
- **Consequences:** cheap to encode; brittle against change (mitigated by the byte-level
  regression test); needs tooling to read on the wire (the probe); versioned by a leading
  byte so evolution is possible.
- **The 44 vs. 200 bytes point:** the wire record is far smaller than the master context's
  ~200-byte normalized event. That inflation is real and happens at normalization — worth
  stating, because it changes the capacity arithmetic between exchange link and Kafka.

### ADR 002 — Slow consumers are disconnected, not thinned

`docs/decisions/002-slow-consumer-policy.md`

The most defensible decision in Phase 2, and the one most likely to be challenged.

- **Context:** a consumer that cannot keep up with a sequenced 25K/sec feed.
- **Alternatives:** unbounded buffering (the source's memory becomes the consumer's
  problem — unacceptable); block the producer (the failure mode the whole architecture
  exists to prevent); drop oldest / coalesce (fine for a *display* stream, wrong for a
  *sequenced* one — a gap is indistinguishable from corruption); disconnect (chosen).
- **Decision:** bounded buffer, then disconnect; `DropOldest` retained as a configurable
  alternative for Phase 11 experiments.
- **Consequences:** the consumer must implement reconnection — which is Phase 3's job
  anyway; sequence integrity is preserved; the failure is loud.
- **The connection to Phase 11:** the gateway faces the same choice with slow WebSocket
  clients and will likely answer it *differently* — a price display genuinely wants
  latest-value-wins coalescing. Articulating why the same problem gets opposite answers at
  two layers is a strong interview moment: the semantics of the stream decide the policy,
  not a general preference.

### ADR 003 — Skewed symbol distribution from day one

`docs/decisions/003-symbol-distribution.md`

- **Context:** real tapes are dominated by a handful of names.
- **Alternatives:** uniform (simple, and quietly invalidates every fan-out and
  partitioning measurement); configurable Zipf (chosen); replay of real captured data
  (best realism, no data available).
- **Decision:** weighted alias-method selection, Zipf-like tail, weights in `symbols.json`.
- **Consequences:** hot symbols are visible from Phase 2 rather than discovered in
  Phase 15; Kafka partition imbalance will be real when we get there; benchmarks are
  harder to hit, which is the point.

### ADR 004 — Deterministic seeded generation

`docs/decisions/004-deterministic-generation.md`

- **Context:** benchmark results must be comparable across phases and machines.
- **Decision:** xoshiro256\*\*, explicit seed, seed logged on every startup.
- **Consequences:** reproducible tapes; the same seed must be recorded alongside every
  benchmark result or the reproducibility is theoretical.

### Protocol reference

`docs/phase-2-mock-exchange/wire-protocol.md`

Extract the protocol spec from task 01 into a standalone reference — layouts, message
types, sequence semantics, symbol encoding, worked byte-level example of a single encoded
`COMI` trade. This is what whoever implements Phase 3 ingestion reads. It should be
complete enough that they never need to open the C# to understand the format.

### Repository README

`README.md` at the repo root. Currently empty.

- What Tckr is, in three sentences, with the interview framing stated honestly.
- The architecture diagram from the master context.
- Current status: which phases are done, which is in progress.
- Prerequisites and how to run what exists today.
- Repository layout.
- Links to the master context, phase plans and ADRs.

Keep it short. The master context is the deep document; the README is the front door.

### ADR format

Standard, consistent across all four:

```markdown
# ADR NNN — Title

- **Status:** Accepted
- **Date:** YYYY-MM-DD
- **Phase:** 2 — Mock Exchange
- **Deciders:** …

## Context
## Decision
## Alternatives Considered
## Consequences
## Revisit If
```

`Revisit If` matters: it names the condition that would invalidate the decision, which is
what keeps a set of ADRs from becoming a museum of past certainty.

---

## Acceptance criteria

- [ ] Four ADRs in `docs/decisions/`, consistent format, real alternatives with real
      trade-offs rather than straw men.
- [ ] `wire-protocol.md` complete enough to implement a decoder from, including a worked
      byte-level example.
- [ ] Root `README.md` written, with accurate current status.
- [ ] Every ADR has a populated `Revisit If`.
- [ ] Cross-links between README, master context, phase plan and ADRs all resolve.

## Verification

Read each ADR and ask: could someone who disagrees with this decision tell, from the
document alone, that their objection was genuinely considered? If not, the Alternatives
section is decoration and needs rewriting.

## Notes for other tasks

Tasks 05 and 08 are each asked to record a decision for the ADRs (encode-once-fan-out
strategy; shared vs. duplicated codec in the probe). Collect those from their Notes
sections before writing ADRs 001 and 002.
