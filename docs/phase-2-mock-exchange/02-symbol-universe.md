# Task 02 — Symbol Universe & Weighted Selection

| | |
|---|---|
| **Phase** | 2 — Mock Exchange |
| **Status** | Complete |
| **Depends on** | — |
| **Blocks** | 03 |
| **Parallel with** | 01, 04 |
| **Owns** | `src/Tckr.MockExchange/Reference/**`, `tests/Unit/Tckr.MockExchange.Tests/Reference/**` |

> **Scaffolding is already done.** The test project (`tests/Unit/Tckr.MockExchange.Tests`,
> xUnit + Shouldly + `FakeTimeProvider` + `MetricCollector`), the probe project
> (`tools/Tckr.FeedProbe`), both `InternalsVisibleTo` entries, the empty area folders under
> `src/Tckr.MockExchange/`, and the `src/Tckr.slnx` registrations all exist and build.
> Add your files into the existing structure; do not re-create projects or touch the
> solution file.

---

## Objective

Provide the tradable universe — symbols, reference prices, tick sizes — and a
**weighted picker** that reproduces the skewed activity distribution of a real tape.

---

## Why this matters

Uniform symbol distribution is the single most misleading simplification a mock feed can
make. It makes fan-out look cheap, makes Kafka partitions look balanced, and makes hot
symbols invisible until Phase 15, at which point every earlier measurement has to be
redone.

The master context is explicit:

```text
COMI  → 500,000 users
XYZ   → 100 users
```

The tape is skewed the same way. Build that in from the start.

---

## Specification

### `SymbolDefinition`

```csharp
internal sealed record SymbolDefinition
{
    internal required string Symbol { get; init; }        // 1–8 chars, ASCII uppercase
    internal required string Name { get; init; }
    internal required decimal ReferencePrice { get; init; }
    internal required decimal TickSize { get; init; }     // minimum price increment
    internal required int LotSize { get; init; }          // typical trade size unit
    internal required double Weight { get; init; }        // relative activity share
}
```

Validation on load: symbol matches `^[A-Z0-9]{1,8}$`, `ReferencePrice > 0`,
`TickSize > 0`, `LotSize > 0`, `Weight > 0`, and no duplicate symbols. Fail fast at
startup with a clear message — a malformed universe should never reach the hot path.

### `symbols.json`

Embedded resource at `src/Tckr.MockExchange/Reference/symbols.json`. Include the four
symbols the master context uses throughout (`COMI`, `CIB`, `ORAS`, `SWDY`) plus a
realistic EGX-flavoured set, roughly 30–40 named symbols. Suggested additions:
`HRHO`, `TMGH`, `EAST`, `ETEL`, `ABUK`, `SKPC`, `ESRS`, `AMOC`, `MNHD`, `PHDC`,
`EFIH`, `ORWE`, `JUFO`, `ISPH`, `CLHO`, `EKHO`, `SUGR`, `ADIB`, `CCAP`, `GBCO`,
`FWRY`, `MTIE`, `ARCC`, `EGTS`, `PRDC`, `OCDI`, `AUTO`, `RAYA`, `SPMD`, `BINV`.

Prices should be plausible and varied across magnitudes (single digits through several
hundred) so downstream formatting and fixed-point handling get exercised. Tick sizes
should follow a simple banded convention — document the bands in the JSON header
comment or alongside in the file.

> These are fictional instruments that borrow real-world ticker shapes for realism.
> State that in the file so nobody mistakes the data for market reference data.

### Synthetic padding

The universe size is configurable (default **250**). Named symbols come from JSON;
the remainder are generated as `SYN0001`…`SYNnnnn` with:

- Reference price drawn deterministically from the seed, range `5.00`–`500.00`.
- Weight from a Zipf tail so they are individually rare.

Generation must be deterministic given the seed, so the universe is reproducible.

### Weight distribution

Target shape, verified by test:

- Top 1 symbol: **10–18%** of selections.
- Top 10 symbols: **≥ 50%** of selections.
- Top 50 symbols: **≥ 85%** of selections.
- Every symbol has non-zero probability.

Named symbols carry explicit weights in JSON; synthetic ones follow `weight ∝ 1/rank^s`
with `s ≈ 1.1`. Normalise across the whole universe at load time.

### `SymbolUniverse`

```csharp
internal sealed class SymbolUniverse
{
    internal static SymbolUniverse Load(int size, ulong seed);

    internal int Count { get; }
    internal ReadOnlySpan<SymbolDefinition> Symbols { get; }
    internal SymbolDefinition this[int index] { get; }
    internal bool TryGetIndex(string symbol, out int index);
}
```

Indexed by `int` throughout. The hot path must never look a symbol up by string.

### `WeightedSymbolPicker`

```csharp
internal sealed class WeightedSymbolPicker
{
    internal WeightedSymbolPicker(ReadOnlySpan<double> weights);
    internal int Next(ulong random);   // returns a symbol index
}
```

Use **Vose's alias method**: O(1) per pick with two array reads, versus O(log n) for
cumulative-weight binary search. At 25K picks/sec the difference is not the point —
predictable, branch-light, allocation-free selection is.

`Next` takes a raw 64-bit random value from the caller's RNG rather than owning one, so
task 03 controls seeding and reproducibility. Document that contract clearly.

---

## Tests

`tests/Unit/Tckr.MockExchange.Tests/Reference/`

- `symbols.json` loads, parses, and passes validation.
- The four master-context symbols (`COMI`, `CIB`, `ORAS`, `SWDY`) are present.
- Duplicate symbol in the JSON fails loudly.
- Invalid symbol / non-positive price / zero weight each fail with a useful message.
- Universe of 250 has exactly 250 unique symbols.
- Same seed → identical universe (symbols, prices, weights) across two loads.
- Alias-method distribution: 1,000,000 picks land within **±1%** of configured weights
  (chi-square or per-symbol tolerance, your choice — assert it, don't eyeball it).
- Skew assertions: top-1, top-10 and top-50 share thresholds above.
- Every symbol is selected at least once in 1,000,000 picks.
- `Next` allocates zero bytes over 100,000 calls.

---

## Acceptance criteria

- [ ] `symbols.json` embedded, validated at load, with ≥ 30 named symbols.
- [ ] Universe size configurable; synthetic padding deterministic from the seed.
- [ ] Alias method implemented; `Next` is O(1) and allocation-free.
- [ ] Distribution and skew proven by test, not asserted in prose.
- [ ] No string-keyed lookups on the hot path.
- [ ] `dotnet build src/Tckr.slnx` and `dotnet test` pass.

## Verification

```bash
dotnet test tests/Unit/Tckr.MockExchange.Tests --filter FullyQualifiedName~Reference
```

## Notes for other tasks

### The surface task 03 codes against

```csharp
// Reference/SymbolUniverse.cs
internal sealed class SymbolUniverse
{
    internal const int DefaultSize = 250;          // configurable universe size
    internal const int MaxSize     = 99_999;       // SYNnnnnn still fits eight wire bytes
    internal const string SyntheticPrefix = "SYN";

    internal static SymbolUniverse Load(int size = DefaultSize, ulong seed = 0);
    internal static SymbolUniverse LoadFrom(string symbolsJson, int size, ulong seed, string origin = "symbols.json");

    internal int Count { get; }
    internal SymbolDefinition this[int index] { get; }
    internal ReadOnlySpan<SymbolDefinition> Symbols { get; }   // ordered most-active first
    internal ReadOnlySpan<Symbol8> PackedSymbols { get; }      // parallel to Symbols
    internal ReadOnlySpan<double> Weights { get; }             // parallel, normalised, sums to 1
    internal WeightedSymbolPicker CreatePicker();

    internal bool TryGetIndex(string symbol, out int index);   // config / diagnostics only
    internal bool TryGetIndex(Symbol8 symbol, out int index);  // decode path only
}

// Reference/WeightedSymbolPicker.cs
internal sealed class WeightedSymbolPicker
{
    internal WeightedSymbolPicker(ReadOnlySpan<double> weights);
    internal int Count { get; }
    internal int Next(ulong random);   // O(1), allocation-free, aggressively inlined
}
```

`Next(ulong random)` is unchanged from the brief. The intended wiring in task 03 is:

```csharp
var universe = SymbolUniverse.Load(options.UniverseSize, options.Seed);
var picker   = universe.CreatePicker();
...
int index = picker.Next(rng.NextUInt64());       // rng is task 03's seeded xoshiro256**
Symbol8 symbol = universe.PackedSymbols[index];  // no string, no allocation
```

Points that matter downstream:

- **`Next` splits the word: high 32 bits pick the bucket, low 32 bits are the coin.** The two
  halves are disjoint, so they are independent for any generator with uniform 64-bit output
  (xoshiro256\*\*, PCG, SplitMix64). Do **not** hand it the raw output of a generator with weak
  low bits, such as a plain LCG. One `NextUInt64()` per pick is enough; do not try to reuse a
  draw across the symbol pick and the price step.
- **Additions beyond the brief's sketch, all additive:** `PackedSymbols`, `Weights`,
  `CreatePicker()`, `TryGetIndex(Symbol8, ...)`, `LoadFrom(...)`, `Count` on the picker, and the
  `DefaultSize` / `MaxSize` / `SyntheticPrefix` constants. Nothing in the brief's signature list
  changed.
- **The universe is ordered by descending weight**, so index 0 is always the hottest symbol
  (COMI) and `Symbols[..10]` is the head of the tape. Task 07 can report "top 10 share" without
  sorting anything. A universe smaller than the named set truncates to the most active names
  rather than throwing.
- **`SymbolDefinition.Packed` is the `Symbol8`,** converted once at load time. `Symbol` and
  `Name` are strings for logs and configuration; the generation loop must not read them.
- **`ReferencePrice` is an exact multiple of `TickSize`** for every symbol, named and synthetic
  (asserted by test). The random walk can therefore step in whole ticks from the reference price
  and stay on the grid.
- **Everything is `internal`, in `Tckr.MockExchange.Reference`.** No package reference was added
  to either project.

### Request for task 06 (owns `Tckr.MockExchange.csproj`)

Please add:

```xml
<ItemGroup>
  <EmbeddedResource Include="Reference\symbols.json" />
</ItemGroup>
```

`SymbolUniverse.Load` already asks for the manifest resource
`Tckr.MockExchange.Reference.symbols.json` first. Until that entry exists it falls back to the
copy the SDK places next to the assembly (the Worker SDK globs `**/*.json` as `Content` with
`CopyToOutputDirectory=PreserveNewest`, and that content flows into the test project's output
too), so the build and tests are green today either way. The embedded entry makes the universe
independent of the output layout and survives single-file publish. Both paths are load-time only.

Also worth wiring into `GenerationOptions`: `UniverseSize` (default `SymbolUniverse.DefaultSize`
= 250) and the run `Seed`, both passed straight to `SymbolUniverse.Load`.

### Measured distribution — 1,000,000 draws, universe of 250, fixed seeds

| Metric | Measured | Target |
|---|---|---|
| Top 1 (COMI) | **14.43%** | 10-18% |
| Top 10 | **59.20%** | >= 50% |
| Top 50 | **98.66%** | >= 85% |
| Rarest symbol | 12 draws (expected 21) | >= 1 |
| Worst absolute share deviation | 0.0496% | < 1pp |
| Worst per-symbol z-score | 2.59 | < 5 |
| Chi-square (249 df) | 262.5, z = 0.60 | \|z\| < 5 |
| `Next` allocation over 100,000 calls | 0 bytes | 0 |

The brief's "within +-1% of configured weights" is asserted two ways, because a single reading of
it is either vacuous or impossible: a per-symbol bound of one percentage point of share (which
binds at the head), plus a per-symbol z-score and a whole-universe chi-square (which bind in the
tail, where a symbol expects ~21 hits in a million and no percentage-point bound can say
anything). The 4-symbol control case does assert a genuine 1% *relative* error per bucket.

Shape of the distribution: 34 named symbols carry explicit weights in `symbols.json`
(1000 down to 60, roughly Zipf); the 216 synthetic symbols follow
`weight = 0.9 x leastNamedWeight / rank^1.1`, which keeps the entire tail strictly rarer than
every named ticker. Weights are normalised across the whole universe at load time, so the targets
above hold at any universe size (verified analytically at 34 / 60 / 250 / 1000).

### For task 10 (ADRs)

Two decisions here are worth recording:

- **Vose's alias method over cumulative-weight binary search.** The argument is not raw speed at
  25K/sec; it is that the alias table's cost is constant *and independent of the distribution*.
  Binary search makes hot symbols cheaper to pick than cold ones, so per-event cost would
  correlate with which symbol came out, and Phase 4's latency histograms would carry a
  distribution-shaped artefact.
- **The picker does not own an RNG.** `Next(ulong)` takes the caller's draw so that one seed
  reproduces a tape end to end. A picker with its own `Random` would be a second, unseeded source
  of randomness hiding behind a reproducible-looking API.

Minor, probably not ADR-worthy but worth a line in the protocol doc: the universe's listing rule
is `^[A-Z0-9]{1,8}$`, strictly narrower than the wire codec's "any printable non-space ASCII".
Framing decides what *can* be encoded; the universe decides what this exchange is willing to
list.

### Verified

```text
dotnet build src/Tckr.slnx                                              Build succeeded
dotnet test  tests/Unit/Tckr.MockExchange.Tests --filter ...Reference   55 passed, 0 failed
dotnet test  src/Tckr.slnx                                              200 passed, 0 failed
```
