# Task 03 — Price & Quote Generation Engine

| | |
|---|---|
| **Phase** | 2 — Mock Exchange |
| **Status** | Complete |
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

- [x] xoshiro256\*\* implemented and seeded via SplitMix64.
- [x] `SymbolState[]` pre-allocated; no dictionary or string lookups in `Generate`.
- [x] All price arithmetic in scaled integers; no `double` touches a price.
- [x] `Generate` allocates zero bytes, proven by test.
- [x] Reproducibility proven by test.
- [x] ≥ 1M events/sec single-threaded in Release — measured at 36.4M.
- [x] Sequence numbers deliberately left to task 05, documented.

## Verification

```bash
dotnet test tests/Unit/Tckr.MockExchange.Tests --filter FullyQualifiedName~Generation
dotnet test tests/Unit/Tckr.MockExchange.Tests -c Release --filter Category=Benchmark
```

## Notes for other tasks

### Delivered

| File | What it is |
|---|---|
| `src/Tckr.MockExchange/Generation/Xoshiro256StarStar.cs` | The RNG. SplitMix64 seeding, `NextUInt64` / `NextDouble` / `NextInt`. Not thread-safe by design. |
| `src/Tckr.MockExchange/Generation/SymbolState.cs` | Per-symbol walking state, held in a pre-allocated array and mutated through `ref`. |
| `src/Tckr.MockExchange/Generation/GenerationOptions.cs` | Seed, walk shape, message mix, timestamp mode. **Placeholder in this folder — task 06 owns it.** |
| `src/Tckr.MockExchange/Generation/IMarketDataGenerator.cs` | The contract task 06 depends on. |
| `src/Tckr.MockExchange/Generation/RandomWalkGenerator.cs` | The implementation. |
| `tests/Unit/Tckr.MockExchange.Tests/Generation/Xoshiro256StarStarTests.cs` | 8 test methods / 13 cases, incl. a recorded seed-0 stream prefix. |
| `tests/Unit/Tckr.MockExchange.Tests/Generation/RandomWalkGeneratorTests.cs` | 26 tests, covering every item in the brief's Tests section. |
| `tests/Unit/Tckr.MockExchange.Tests/Generation/RandomWalkGeneratorBenchmarkTests.cs` | 1 test, `[Trait("Category", "Benchmark")]`, skipped in Debug. |

### For task 06 — the surface to wire up

```csharp
internal interface IMarketDataGenerator
{
    void Generate(Span<FeedRecord> destination);   // fills the whole span; no return count
    void ResetSession();
}

internal sealed class RandomWalkGenerator : IMarketDataGenerator
{
    internal RandomWalkGenerator(
        SymbolUniverse universe,               // required
        GenerationOptions? options = null,     // null => shipped defaults
        TimeProvider? timeProvider = null);    // null => TimeProvider.System

    internal int SymbolCount { get; }
    internal int MaxTickMove { get; }
    internal ReadOnlySpan<SymbolState> States { get; }   // diagnostics and tests only
}
```

Registration is a plain singleton; the generator holds no unmanaged resources and is not
`IDisposable`. It is **not thread-safe** — one instance drives one generation loop, which is what
the publisher does anyway. Construct it once at startup: the constructor allocates the state array,
the alias table and the packed-symbol copy, and calls `ResetSession()` for you, so a freshly
constructed generator is ready to emit.

`TimeProvider` is read exactly once, to anchor the timestamp epoch. It is not consulted per event
and not consulted again on a session reset, so a `FakeTimeProvider` in a host test controls the
epoch and nothing else.

Three things about `GenerationOptions`:

1. It lives in `Generation/` as a placeholder, exactly as task 04's `MarketSessionOptions` and task
   05's `FeedServerOptions` do. Move it to `Options/GenerationOptions.cs` verbatim; the file's own
   `TODO(task-06)` header says what changes and what does not.
2. It is a `record` so callers can write `options with { Seed = x }`. Every property is settable,
   so the configuration binder treats it as an ordinary POCO. Section name: `MockExchange:Generation`.
3. Properties are `public` on an `internal` type on purpose — the reflection binder skips
   non-public properties, so internal ones would bind to silence rather than to an error.

`ResetSession()` is what task 06 should call when the market session clock leaves `Closed`. It
re-anchors each symbol where its price currently sits (today's reference is yesterday's close), not
back at the reference-data price; see the XML doc for why. It does **not** restart the timestamp
clock, so timestamps stay non-decreasing across the boundary.

### Measured

On the development machine (Apple silicon, .NET 10, Release, single thread):

```text
events        : 19,996,672
elapsed       : 0.549 s
throughput    : 36,400,737 events/sec (floor 1,000,000)
per event     : 27.5 ns
headroom      : 1,456.0x the 25,000/sec target
allocated     : 0 bytes
gen0 collects : 0
```

Zero allocation is asserted twice — in the benchmark above and, in the default Debug suite, by
`Generate_AllocatesNothing`, which drives 1,000,000 events through `IMarketDataGenerator` into a
reused buffer and requires `GC.GetAllocatedBytesForCurrentThread()` to be unchanged.

Message mix over 1,000,000 events: Trade 40.080%, BidQuote 29.923%, AskQuote 29.998% against a
configured 40 / 30 / 30. Block trades 1.015% against a configured 1%. Largest single price move
3 ticks against a configured `MaxTickMove` of 3. With reversion disabled and a twenty-tick band,
the walk reaches both limits exactly and passes neither.

### Deviations from the brief, and why

1. **`SymbolState` carries seven more fields than the brief's sketch.** The brief's struct has no
   band bounds, but the brief also requires a ±10% clamp and tick alignment; deriving the bounds
   per event would mean a multiply and two divisions per event to recompute what never changes.
   The added fields are `MidPriceScaled`, `LowerBandScaled`, `UpperBandScaled`,
   `ReversionSpanScaled` and `ReversionMultiplier`.

2. **`MidPriceScaled` is separate from `LastTradePriceScaled`.** The brief has one field and names
   it after the last trade. If the walk resumed from the last *printed* trade, each step would
   carry the print's offset inside the spread on top of the tick move, and a symbol could travel
   further between consecutive events than `MaxTickMove` allows — which is exactly the continuity
   property the brief asks to be tested. The walk therefore runs on the mid; the print is derived
   from it and does not feed back. `LastTradePriceScaled` is kept and means what it says.

3. **Mean reversion is proportional, with no threshold band.** The brief describes both
   ("strength proportional to current deviation" and "if `|last - reference| > band`, skew the
   sign") and the two are different mechanisms. Implemented as the proportional one: the
   probability of moving towards the anchor is `0.5 + 0.5 × strength × |deviation| / span`,
   computed as a shift-multiply against a per-symbol reciprocal so it costs no division. A
   threshold would put a visible discontinuity in the walk's behaviour at one distance, for no
   gain. `MeanReversionStrength` defaults to `0.9`, which leaves the ±10% clamp a live backstop
   rather than dead code.

4. **The band is configured in basis points, not as a percentage.** `DailyBandBasisPoints = 1000`
   is ±10%. An integer, so the bound stays inside integer arithmetic end to end.

5. **The band half-width has a floor of `MaxSpreadTicks` ticks.** Otherwise an instrument whose
   tick exceeds a few percent of its own price would have a band too narrow to hold a two-sided
   quote, and the quote-shift logic would fight itself. No symbol in the current universe comes
   near the floor; it is there so the `Bid < Ask` invariant is structural rather than lucky.

6. **`GenerationOptions.DeterministicTimestamps` was added, off by default.** The brief's
   reproducibility test asks for "identical records", and the Phase 2 Definition of Done asks for
   "byte-identical tapes" — neither is achievable while `ExchangeTimestampNanos` comes from a wall
   clock, which by definition does not repeat. With the flag on, the clock is synthetic and
   advances a fixed step per event, so the tape is byte-identical; with it off (the default,
   and what a benchmark run uses) a seeded run reproduces every field *except* the timestamp,
   which the tests assert separately. See the note below — this is the one place where I think
   the brief was underspecified rather than wrong.

7. **`SymbolState.TradesToday` counts trade prints only** and is cleared by `ResetSession`. The
   brief lists the field but does not say what maintains it.

### Requests for files this task does not own

1. **`src/Tckr.MockExchange/Options/GenerationOptions.cs` (task 06).** Move
   `Generation/GenerationOptions.cs` there and delete the placeholder. Nothing else changes if the
   namespace is kept; the file header spells out the alternative.

2. **`FeedRecord.Flags` and `FeedRecord.AuctionPrintFlag` (tasks 04 / 06).** The generator emits
   `Flags = 0` for every record, so `AuctionPrintFlag` is currently never set by anything. Whether
   a print came out of an auction is the market session clock's knowledge (`MarketPhase`), not the
   generator's, and wiring it in here would mean this type taking a dependency on the phase
   schedule to set one bit. Two ways to close it, in preference order:
   - task 06 sets the bit on the batch it just generated, since it holds both the clock and the
     buffer — one `if` over the batch, no new coupling; or
   - task 04/06 agree a `MarketPhase` parameter on `Generate`, which changes the interface and
     therefore needs to be decided before task 06 wires anything up.

   Until one of them happens, `AuctionPrintFlag` is defined on the wire and never observed on it.
   Task 08's probe should not assert on it.

3. **Nothing else.** No change was needed in `Protocol/`, `Reference/`, `Session/`, `Feed/`,
   `Program.cs` or any `.csproj`.

### Note on the brief

The one genuine gap is the timestamp/reproducibility tension in point 6 above: "two generators,
same seed, 100,000 events → identical records" cannot hold for a record that carries a wall-clock
timestamp, and the Phase 2 DoD's "byte-identical tapes" cannot hold either. Both are now satisfied,
but only because a mode was added that the brief did not ask for. Worth deciding deliberately:
should `DeterministicTimestamps` be the default for benchmark *tape comparison* runs (task 09), or
should task 09 compare tapes with the timestamp field masked out? The current default — real clock
— is the right one for anything that measures latency, and the wrong one for anything that
compares tapes.
