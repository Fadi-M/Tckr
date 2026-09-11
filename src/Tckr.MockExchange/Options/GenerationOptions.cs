using System.ComponentModel.DataAnnotations;
using Tckr.MockExchange.Generation;
using Tckr.MockExchange.Reference;

namespace Tckr.MockExchange.Options;

// Handed over from task 03, which owned this file as a placeholder under Generation/. The move is
// verbatim apart from the namespace and the binding attributes: property names, types and defaults
// are unchanged, because RandomWalkGeneratorTests asserts several of the defaults directly and
// every default is part of the reproducible tape.
//
// Binding note: the type is internal (per the Phase 2 conventions) but its properties are public
// on purpose, matching MarketSessionOptions. Microsoft.Extensions.Configuration's reflection
// binder ignores non-public properties unless BindNonPublicProperties is set, so internal
// properties here would bind to silence rather than to an error.

/// <summary>
/// Configuration for <see cref="RandomWalkGenerator"/>: the seed, the shape of the walk, the
/// message mix, and how timestamps are produced.
/// </summary>
/// <remarks>
/// <para>
/// Probabilities are expressed as <see cref="double"/> here and converted once, in the generator's
/// constructor, into fixed-point thresholds. Nothing in this type ever reaches a price: prices are
/// derived from the symbol universe's <see cref="decimal"/> reference data and then live entirely
/// in scaled <see cref="long"/> arithmetic.
/// </para>
/// <para>
/// A <c>record</c> rather than a plain class purely so that a caller can say "the defaults, but
/// with a different seed" as <c>options with { Seed = x }</c>. Every property is still settable,
/// so the configuration binder treats it as an ordinary POCO.
/// </para>
/// </remarks>
internal sealed record GenerationOptions
{
    /// <summary>Configuration section this binds from.</summary>
    internal const string SectionName = $"{MockExchangeOptions.SectionName}:Generation";

    /// <summary>Default distance, in ticks, of the largest single price move.</summary>
    internal const int DefaultMaxTickMove = 3;

    /// <summary>Default daily price band: 1,000 basis points either side of the anchor, i.e. &#177;10%.</summary>
    internal const int DefaultDailyBandBasisPoints = 1_000;

    /// <summary>
    /// Run seed. The same seed, the same universe and the same options reproduce the same tape.
    /// </summary>
    /// <remarks>
    /// The default is a fixed non-zero constant rather than a clock- or process-derived value, so
    /// that a benchmark run with no configuration at all is still reproducible. A run that wants a
    /// different tape must say so, because the failure mode of the opposite default &#8212;
    /// silently unreproducible benchmarks &#8212; is invisible until someone tries to compare two
    /// of them.
    /// </remarks>
    public ulong Seed { get; set; } = 0x5443_4B52_5345_4544UL; // "TCKRSEED"

    /// <summary>
    /// Number of instruments in the universe, passed straight to <see cref="SymbolUniverse.Load"/>.
    /// </summary>
    /// <remarks>
    /// Lives here rather than on the root options because the universe and the walk that runs on
    /// it are one reproducibility unit: the same <see cref="Seed"/> against a different universe
    /// size is a different tape. Beyond the named symbols in <c>symbols.json</c> the universe is
    /// filled with synthetic ones, so any size up to <see cref="SymbolUniverse.MaxSize"/> is valid.
    /// </remarks>
    [Range(1, SymbolUniverse.MaxSize)]
    public int UniverseSize { get; set; } = SymbolUniverse.DefaultSize;

    /// <summary>Largest single price move, in ticks. A move of zero ticks is also drawn.</summary>
    [Range(0, 20)]
    public int MaxTickMove { get; set; } = DefaultMaxTickMove;

    /// <summary>
    /// Half-width of the daily price band, in basis points of the session anchor.
    /// </summary>
    /// <remarks>
    /// An exchange-style limit-up / limit-down rule, and also the thing that stops a several-hour
    /// run from random-walking a &#36;40 stock to &#36;4,000 and making every downstream chart
    /// useless. The band is a hard clamp; mean reversion is what normally keeps the price away
    /// from it (see <see cref="MeanReversionStrength"/>).
    /// </remarks>
    [Range(1, 10_000)]
    public int DailyBandBasisPoints { get; set; } = DefaultDailyBandBasisPoints;

    /// <summary>
    /// How strongly the walk is pulled back towards the session anchor, in <c>[0, 1]</c>.
    /// </summary>
    /// <remarks>
    /// The pull is proportional to how far the price has already travelled: at the anchor the next
    /// move is a fair coin, and at the edge of the band the probability of moving back towards the
    /// anchor is <c>0.5 + 0.5 &#215; strength</c>. At <c>1.0</c> the walk can never leave the band
    /// at all and the clamp becomes dead code; at <c>0</c> it is an unbiased random walk that
    /// leans on the clamp. The default sits just below <c>1.0</c> deliberately, so the clamp is a
    /// backstop that does occasionally fire rather than a comment.
    /// </remarks>
    [Range(0d, 1d)]
    public double MeanReversionStrength { get; set; } = 0.9;

    /// <summary>Relative share of trade prints in the message mix.</summary>
    [Range(0d, double.MaxValue)]
    public double TradeShare { get; set; } = 0.40;

    /// <summary>Relative share of bid updates in the message mix.</summary>
    [Range(0d, double.MaxValue)]
    public double BidQuoteShare { get; set; } = 0.30;

    /// <summary>Relative share of ask updates in the message mix.</summary>
    [Range(0d, double.MaxValue)]
    public double AskQuoteShare { get; set; } = 0.30;

    /// <summary>Narrowest top-of-book spread, in ticks. At least one, so <c>Bid &lt; Ask</c> always.</summary>
    [Range(1, 1_000)]
    public int MinSpreadTicks { get; set; } = 1;

    /// <summary>Widest top-of-book spread, in ticks.</summary>
    [Range(1, 1_000)]
    public int MaxSpreadTicks { get; set; } = 4;

    /// <summary>Smallest ordinary order size, in lots.</summary>
    [Range(1, int.MaxValue)]
    public int MinLots { get; set; } = 1;

    /// <summary>Largest ordinary order size, in lots.</summary>
    [Range(1, int.MaxValue)]
    public int MaxLots { get; set; } = 20;

    /// <summary>Probability that an event carries a block-sized quantity instead of an ordinary one.</summary>
    /// <remarks>
    /// A long tail on order size is not decoration: it is what makes downstream aggregation code
    /// meet a quantity two orders of magnitude above the median before production does.
    /// </remarks>
    [Range(0d, 1d)]
    public double BlockTradeProbability { get; set; } = 0.01;

    /// <summary>Smallest block size, in lots.</summary>
    [Range(1, int.MaxValue)]
    public int BlockMinLots { get; set; } = 50;

    /// <summary>Largest block size, in lots.</summary>
    [Range(1, int.MaxValue)]
    public int BlockMaxLots { get; set; } = 200;

    /// <summary>
    /// Replaces the monotonic wall clock with a synthetic one that advances a fixed step per
    /// event, making the tape byte-identical between runs.
    /// </summary>
    /// <remarks>
    /// Off by default. With the real clock a seeded run reproduces every field of every record
    /// except <c>ExchangeTimestampNanos</c>, which by definition cannot repeat; that is the right
    /// default for benchmarking, where the exchange timestamp is the origin of every downstream
    /// latency measurement and a fake one would make those measurements meaningless. Turn this on
    /// for the case the Phase 2 Definition of Done names &#8212; proving two runs with the same
    /// seed produce identical tapes &#8212; and for golden-file tests, and nowhere else.
    /// </remarks>
    public bool DeterministicTimestamps { get; set; }

    /// <summary>
    /// Nanoseconds between consecutive events when <see cref="DeterministicTimestamps"/> is set.
    /// Defaults to 40,000 ns, the spacing implied by the Phase 2 target of 25,000 events/sec.
    /// </summary>
    [Range(0L, long.MaxValue)]
    public long DeterministicStepNanos { get; set; } = 40_000;

    /// <summary>
    /// Epoch the synthetic clock starts from: 2025-01-02T09:30:00Z, in Unix nanoseconds.
    /// </summary>
    /// <remarks>
    /// A constant rather than the current time, because a tape that is only reproducible on the
    /// day it was captured is not reproducible.
    /// </remarks>
    public long DeterministicEpochUnixNanos { get; set; } = 1_735_810_200_000_000_000L;
}
