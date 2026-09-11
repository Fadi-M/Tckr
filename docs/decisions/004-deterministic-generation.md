# ADR 004 — Deterministic seeded generation

- **Status:** Accepted
- **Date:** 2026-09-10
- **Phase:** 2 — Mock Exchange
- **Deciders:** Task 03, coordinator Fadi Matta

## Context

Benchmark results only mean something if they are comparable — across two runs on the
same machine, and ideally across machines. That requires the generated tape itself to
be reproducible: the same configuration should produce the same sequence of symbols,
prices, quantities and message types every time, so that a throughput or latency
difference between two runs is attributable to something that changed, not to the
random tape itself having been different.

## Decision

`Xoshiro256StarStar`, seeded via SplitMix64 from a single explicit `ulong` seed
(`GenerationOptions.Seed`), drives every random draw in the generator — symbol
selection, price walk direction and magnitude, message-type mix, block-trade flag. The
seed is logged on every process startup (`StartupSummary.Log`) alongside the build
configuration, so a run's reproducibility inputs are on the record even if nobody
thought to write them down separately. There is no "seed 0 means pick one for me": 0 is
a legitimate, tested seed like any other, and overloading it to mean "randomize" would
make the one line that exists to let someone reproduce a run six weeks later report a
seed that is not the seed actually used.

## The gap between the claim and what a wall clock allows

The reproducibility claim as originally specified — "two generators, same seed, produce
identical records" — and the Phase 2 Definition of Done's "two runs with the same seed
produce byte-identical tapes" are **not achievable as stated**, because
`FeedRecord.ExchangeTimestampNanos` is read from a wall clock (`TimeProvider.System` by
default). A wall clock does not repeat by definition; no seed can make two runs agree on
it, and no amount of RNG discipline changes that.

The fix is a `GenerationOptions.DeterministicTimestamps` flag, **off by default**. With
it off, a seeded run reproduces every field of every record *except* the timestamp,
which is asserted separately by test rather than folded into the "identical records"
check. With it on, the clock is synthetic and advances by a fixed step per event, so the
whole tape — timestamp included — is byte-identical across runs, satisfying the DoD's
literal wording.

**The guarantee is therefore conditional, and which clock a run should use depends on
what the run is measuring:**

| Run purpose | Clock | Why |
|---|---|---|
| Throughput / latency measurement (benchmarks, `benchmarks/phase-2/results.md`) | Real (`DeterministicTimestamps = false`, the default) | The number being measured *is* wall-clock behaviour; a synthetic clock would measure nothing real. |
| Tape-identity comparison (proving two runs produced the same sequence of records) | Synthetic (`DeterministicTimestamps = true`) | Only the synthetic clock can make the timestamp field itself reproducible; comparing tapes under the real clock requires masking the timestamp out instead. |

This was flagged in task 03's notes as "the one place I think the brief was
underspecified rather than wrong" — the brief asked for a guarantee that could not hold
against its own definition of a wire field, and the fix (a mode nobody explicitly
requested) is the only way to make both the reproducibility test and the DoD line true
without either lying about what "identical" means or removing the timestamp from the
wire.

## Alternatives Considered

- **No seeding; accept non-reproducible tapes.** Rejected outright — a benchmark whose
  underlying load varies run to run cannot distinguish "the system got slower" from "the
  tape happened to be harder this time," which defeats the purpose of measuring
  anything in Phase 2 at all.
- **Seed everything, including the timestamp, and call the DoD's "byte-identical"
  aspirational rather than literal.** Rejected: this phase's whole ethos, stated
  repeatedly across its task briefs, is measured claims over assumed ones. Leaving a
  known-false claim in the DoD rather than fixing it or narrowing it would be exactly
  the "reconstructed rationalisation" this ADR set exists to avoid producing.
- **`DeterministicTimestamps` flag, off by default (chosen).** Makes both claims true,
  in the mode each actually applies to, at the cost of one more option nobody has to
  touch to get the sensible default.

## Consequences

- Reproducible tapes: given a seed and `DeterministicTimestamps = true`, two runs
  produce byte-identical records including timestamps — useful for tests and for
  proving a code change did not alter the generated distribution.
- Under the default (real clock), a seed still reproduces the *content* of the tape —
  which symbol, which price move, which message type, in the same order — just not the
  timestamps, which is the correct trade-off for anything measuring real elapsed time.
- The seed must be recorded alongside every benchmark result, or the reproducibility is
  theoretical rather than actual. `StartupSummary.BuildConfiguration` and the seed line
  exist so this happens automatically rather than depending on whoever runs the
  benchmark to remember to write it down.
- `RandomWalkGenerator` reads the `TimeProvider` exactly once, at construction, to anchor
  the timestamp epoch — not per event and not again on a session reset — so a
  `FakeTimeProvider` in a test controls the epoch and nothing else, and a session reset
  does not make timestamps jump backward or reset to the epoch.
- Byte-identical reproduction requires the consumer to connect immediately. The tape is
  a single, continuously-running stream, not a session-scoped replay, so a consumer that
  connects even a few seconds late starts mid-tape rather than at record one, and its
  captured tape diverges from the very first byte — even with the same seed and
  `DeterministicTimestamps = true`. This is the shared-tape design working as intended
  (a late joiner sees wherever the tape currently is, per 05-tcp-feed-server.md), not a
  determinism bug, but it means reproducing a specific tape for comparison requires
  racing the socket, not just matching the seed and the flag.

## Revisit If

- A later phase needs the *content* of the tape (not just its timing) to differ
  meaningfully between "real clock" and "synthetic clock" runs — for example, if a
  message-mix or price-walk feature is ever made time-of-day dependent in a way that
  reads real wall-clock time rather than the session clock's phase, the reproducibility
  claim above would need re-deriving.
- Tape-identity comparisons become a routine part of CI rather than an occasional check
  — at that point `DeterministicTimestamps` might be worth flipping to the default for
  test runs specifically, with benchmark runs explicitly opting into the real clock
  instead of the other way around.
- xoshiro256\*\*'s statistical properties turn out to interact badly with the alias
  method's bit-splitting (ADR 003) at a universe size or seed this phase never tested —
  the two decisions share an RNG contract that neither ADR alone fully covers.
