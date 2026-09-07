# Task 03 — Price & Quote Generation Engine

| | |
|---|---|
| **Phase** | 2 — Mock Exchange |
| **Status** | Not started |
| **Depends on** | 01 (`FeedRecord`, `PriceScale`), 02 (`SymbolUniverse`, `WeightedSymbolPicker`) |
| **Blocks** | 06 |
| **Parallel with** | 04, 05, 07 |
| **Owns** | `src/Tckr.MockExchange/Generation/**`, `tests/Unit/Tckr.MockExchange.Tests/Generation/**` |

> **Scaffolding is already done.** The test project (`tests/Unit/Tckr.MockExchange.Tests`,
> xUnit + Shouldly + `FakeTimeProvider` + `MetricCollector`), the probe project
> (`tools/Tckr.FeedProbe`), both `InternalsVisibleTo` entries, the empty area folders under
> `src/Tckr.MockExchange/`, and the `src/Tckr.slnx` registrations all exist and build.
> Add your files into the existing structure; do not re-create projects or touch the
> solution file.

---

## Objective

Turn "a symbol was selected" into a plausible, ordered, reproducible stream of trades and
quotes with per-symbol price continuity — at 25,000 events/sec, without allocating.

---

## Why this matters

Two properties are being bought here, and only two:

1. **Reproducibility.** Same seed, same tape, byte for byte. Without it, no benchmark
   comparison across Phases 4, 9, 15 and 16 means anything.
2. **Continuity.** Prices must walk, not teleport. Downstream we will assert per-symbol
   ordering through Kafka partitions; if the generator emits noise, an ordering bug and
   correct behaviour look identical.

Statistical realism beyond that is explicitly *not* a goal. We are not modelling
volatility clustering or a matching engine.

---

## Specification

### RNG — `Xoshiro256StarStar`

`System.Random` is not reproducible across runtimes and `Random.Shared` is not seedable.
Implement xoshiro256\*\* (~10 lines of state transition):

```csharp
internal sealed class Xoshiro256StarStar
{
    internal Xoshiro256StarStar(ulong seed);   // SplitMix64 to fill the 4-word state
    internal ulong NextUInt64();
    internal double NextDouble();              // [0,1)
    internal int NextInt(int exclusiveMax);     // unbiased (Lemire), no modulo skew
}
```

Not thread-safe by design. One instance per generation loop. Document that.

### Per-symbol state — `SymbolState`

A mutable struct held in a pre-allocated `SymbolState[]` indexed by symbol index. Never
a dictionary, never boxed.

```csharp
internal struct SymbolState
{
    internal long LastTradePriceScaled;
    internal long BidScaled;
    internal long AskScaled;
    internal long ReferencePriceScaled;   // session open, anchor for mean reversion
    internal long TickSizeScaled;
    internal int  LotSize;
    internal uint TradesToday;
}
```

### Price walk

For each generated event:

1. Pick a symbol index via `WeightedSymbolPicker.Next(rng.NextUInt64())`.
2. Draw a tick move in `[-MaxTickMove, +MaxTickMove]` (default `MaxTickMove = 3`).
3. Apply **mean reversion**: bias the move toward `ReferencePrice` with strength
   proportional to current deviation. A simple, cheap form —
   if `|last - reference| > band`, skew the sign probability toward closing the gap.
   No `Math.Exp`, no `Math.Log`, no allocation.
4. Clamp to a daily band of **±10%** around `ReferencePrice` (an exchange-style limit;
   also stops a long run drifting to absurd prices).
5. Snap to `TickSize`. All arithmetic in scaled `long`.
6. Maintain a spread: `Bid = mid - ceil(spreadTicks/2)`, `Ask = bid + spreadTicks`,
   `spreadTicks ∈ [1, 4]`. Enforce the invariant `Bid < Ask` unconditionally.

### Message mix

Configurable, defaulting to:

```text
Trade     40%
BidQuote  30%
AskQuote  30%
```

Trade price sits at or between the current bid and ask. Quantity is a random multiple of
`LotSize`, `1–20` lots, with an occasional (~1%) block trade of `50–200` lots.

### Timestamps

`ExchangeTimestampNanos` comes from a monotonic clock anchored once at startup:

```csharp
nanos = _startUnixNanos + (Stopwatch.GetTimestamp() - _startTicks) * _nanosPerTick;
```

`DateTime.UtcNow` per event is both slow and non-monotonic — never call it in the loop.
Timestamps must be **non-decreasing** across the whole stream; equal values are allowed
(multiple events inside one clock tick).

### Sequence numbers

The generator does **not** own them. Sequence numbers are per-session and are assigned by
the feed session (task 05) at publish time. The generator leaves `SequenceNumber = 0`.
This is a deliberate split: one tape, multiple sessions, each with its own numbering.
Call it out in the XML docs, because it is the kind of thing a reviewer will question.

### Interface

```csharp
internal interface IMarketDataGenerator
{
    void Generate(Span<FeedRecord> destination);   // fills the whole span
    void ResetSession();                            // re-anchor reference prices
}
```

Batch-filling a caller-owned span keeps the loop allocation-free and lets task 06 drive
the batch size from the rate governor.

---

## Tests

`tests/Unit/Tckr.MockExchange.Tests/Generation/`

- **Reproducibility:** two generators, same seed, 100,000 events → identical records.
  Different seeds → different tapes.
- **Continuity:** consecutive prices for a given symbol never move more than
  `MaxTickMove × TickSize`.
- **Band:** across 1,000,000 events, no price escapes ±10% of its reference.
- **Tick alignment:** every price is an exact multiple of the symbol's tick size.
- **Spread invariant:** `Bid < Ask` always; spread within `[1, 4]` ticks.
- **Monotonic timestamps:** never decrease across a 1,000,000-event run.
- **Mix:** message-type ratios within ±1% of configuration over 1,000,000 events.
- **Quantity:** always > 0 and a multiple of the lot size.
- **Zero allocation:** generating 1,000,000 events into a reused buffer allocates 0 bytes
  (`GC.GetAllocatedBytesForCurrentThread()`).
- **Throughput floor:** a single-threaded loop generates **≥ 1,000,000 events/sec** in a
  Release build. If generation cannot beat the target rate by ~40×, the pacing loop will
  never hit 25K cleanly. Mark this test as a benchmark-category test so it can be
  excluded from fast CI runs.

---

## Acceptance criteria

- [ ] xoshiro256\*\* implemented and seeded via SplitMix64.
- [ ] `SymbolState[]` pre-allocated; no dictionary or string lookups in `Generate`.
- [ ] All price arithmetic in scaled integers; no `double` touches a price.
- [ ] `Generate` allocates zero bytes, proven by test.
- [ ] Reproducibility proven by test.
- [ ] ≥ 1M events/sec single-threaded in Release.
- [ ] Sequence numbers deliberately left to task 05, documented.

## Verification

```bash
dotnet test tests/Unit/Tckr.MockExchange.Tests --filter FullyQualifiedName~Generation
dotnet test tests/Unit/Tckr.MockExchange.Tests -c Release --filter Category=Benchmark
```

## Notes for other tasks
