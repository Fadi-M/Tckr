# ADR 003 — Skewed symbol distribution from day one

- **Status:** Accepted
- **Date:** 2026-09-10
- **Phase:** 2 — Mock Exchange
- **Deciders:** Task 02, coordinator Fadi Matta

## Context

Real tapes are dominated by a handful of names — a small number of symbols account for
most of the traffic, and a mock exchange that emits every symbol with equal probability
quietly invalidates every fan-out and partitioning measurement taken against it. Phase
15 ("Solve Scaling & Hot Symbols") exists specifically because hot symbols are a real
production problem for this architecture; a uniform tape would mean Phase 15 discovers
the problem for the first time fifteen phases in, on synthetic data that never modelled
it.

## Decision

A weighted symbol universe with a configurable Zipf-like tail, selected via the **alias
method** (Vose's construction), loaded from `Reference/symbols.json`: 34 named tickers
carry explicit weights (1000 down to 60, roughly Zipf-shaped, symbol `COMI` — the
same instrument used as the master context's own worked example — leading), and the
remaining synthetic symbols (`SYNnnnnn`) fill out the tail at
`weight = 0.9 × leastNamedWeight / rank^1.1`, which keeps every synthetic symbol
strictly rarer than every named one. Weights are normalized across the whole universe
at load time, so the shape holds at any configured universe size.

Two implementation choices matter enough to record alongside the headline decision:

- **The alias method over cumulative-weight binary search.** The argument is not raw
  speed at 25,000/sec — both are fast enough. It is that the alias table's per-pick cost
  is *constant and independent of the distribution*. Binary search over cumulative
  weights makes hot symbols cheaper to reach than cold ones (fewer comparisons to the
  boundary), which means per-event cost would correlate with *which symbol* the draw
  produced — and Phase 4's latency histograms downstream would then carry a
  distribution-shaped artefact that has nothing to do with what Phase 4 is trying to
  measure.
- **The picker does not own an RNG.** `WeightedSymbolPicker.Next(ulong random)` takes
  the caller's draw rather than generating its own. A picker with an internal `Random`
  would be a second, unseeded source of randomness hiding behind an API that otherwise
  looks fully reproducible — the one seed passed to the generator (see ADR 004) would
  stop being the whole story. `Next` also splits its input word deliberately: the high
  32 bits choose the alias bucket, the low 32 bits are the accept/reject coin, which are
  independent halves for any generator with uniform 64-bit output (xoshiro256\*\*, PCG,
  SplitMix64) but not safe to feed from a generator with weak low bits, such as a plain
  LCG.

## Alternatives Considered

- **Uniform distribution.** Simplest possible generator, and the one every naive mock
  exchange defaults to. Rejected: it is not merely less realistic, it actively hides the
  problem this phase exists partly to expose. A partitioning or fan-out strategy that
  looks fine against a uniform tape can fail against a real one, and Phase 2 would have
  produced evidence for a claim ("this fan-out design handles hot symbols") that it
  never actually tested.
- **Configurable Zipf-like weighting via the alias method (chosen).**
- **Replay of real captured exchange data.** Best realism available — an actual tape has
  whatever skew, bursts and correlations a live market produces, with no need to
  approximate them. Rejected for Phase 2 only because no captured data is available; this
  is the alternative most likely to be revisited later (see Revisit If) rather than one
  rejected on principle.

## Consequences

- Hot symbols are visible from Phase 2 onward instead of being discovered as a surprise
  in Phase 15 — every fan-out, partitioning and caching decision from Phase 5 onward can
  be benchmarked against a distribution that already looks like the problem it is meant
  to solve.
- Kafka partition imbalance (Phase 6) will be a real, measurable effect once that phase
  exists, not something introduced synthetically to demonstrate the mitigation.
- Benchmarks are harder to make look good — a partitioning scheme that only performs
  well under uniform load will visibly underperform here, which is the point of building
  it this way rather than a defect to smooth over.
- The universe is ordered by descending weight (`Symbols[0]` is always the hottest —
  `COMI` at the default size), so "top 10 share of the tape" requires no sorting
  anywhere downstream, including in `FeedMetrics`/the probe's symbol-skew reporting.

Measured (1,000,000 draws, universe of 250, fixed seed; `02-symbol-universe.md`):

| Metric | Measured | Target |
|---|---|---|
| Top 1 (`COMI`) | 14.43% | 10–18% |
| Top 10 | 59.20% | ≥ 50% |
| Top 50 | 98.66% | ≥ 85% |
| Worst per-symbol z-score | 2.59 | < 5 |
| Chi-square (249 df), z | 262.5, z = 0.60 | \|z\| < 5 |
| `Next` allocation over 100,000 calls | 0 bytes | 0 |

## Revisit If

- Real captured exchange data becomes available — replaying it is strictly more
  realistic than any synthetic Zipf tail and should displace this decision rather than
  sit alongside it as a mode nobody uses.
- A later phase needs correlated behaviour the alias method cannot produce on its own —
  for example, a symbol's activity spiking in response to a simulated news event, or
  activity correlated across symbols in the same sector. The alias method draws each
  event's symbol independently of history; it has no notion of a symbol "heating up."
- The universe size or weight shape stops matching whatever Phase 15's actual scaling
  work needs to demonstrate — the weights here were picked to be plausible, not derived
  from a specific target imbalance ratio Phase 15 requires.
