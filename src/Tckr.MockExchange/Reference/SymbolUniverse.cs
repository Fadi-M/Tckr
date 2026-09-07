using System.Globalization;
using System.Text.Json;
using Tckr.MockExchange.Protocol;

namespace Tckr.MockExchange.Reference;

/// <summary>
/// The tradable universe: named instruments from <c>symbols.json</c>, padded to a configured size
/// with deterministic synthetic instruments, ordered most-active first and addressed by
/// <see cref="int"/> index.
/// </summary>
/// <remarks>
/// <para>
/// Symbol activity on a real tape is heavily skewed &#8212; the master context's example is COMI with
/// 500,000 subscribers against XYZ with 100. A uniform mock universe would make fan-out look
/// cheap, Kafka partitions look balanced and hot-symbol contention invisible, so the skew is built
/// in here rather than bolted on later.
/// </para>
/// <para>
/// Everything downstream addresses symbols by their <see cref="int"/> index. String lookup exists
/// only for configuration and diagnostics; nothing on the hot path may use it.
/// </para>
/// </remarks>
internal sealed class SymbolUniverse
{
    /// <summary>Default universe size, named symbols included.</summary>
    internal const int DefaultSize = 250;

    /// <summary>Ticker prefix for generated padding instruments.</summary>
    internal const string SyntheticPrefix = "SYN";

    /// <summary>
    /// Upper bound on the universe size. Beyond this the <c>SYNnnnn</c> ticker no longer fits the
    /// eight wire bytes, and a universe this large is not a market anyway.
    /// </summary>
    internal const int MaxSize = 99_999;

    /// <summary>Name of the embedded <c>symbols.json</c> resource.</summary>
    private const string ResourceName = "Tckr.MockExchange.Reference.symbols.json";

    /// <summary>Zipf exponent for the synthetic tail: <c>weight &#8733; 1 / rank^s</c>.</summary>
    private const double SyntheticZipfExponent = 1.1;

    /// <summary>
    /// The first synthetic symbol's weight, as a fraction of the least active named symbol.
    /// Keeps the whole tail strictly rarer than every named instrument, so the padding never
    /// displaces a real ticker from the head of the distribution.
    /// </summary>
    private const double SyntheticHeadFactor = 0.9;

    private const decimal SyntheticMinPrice = 5.00m;
    private const decimal SyntheticMaxPrice = 500.00m;

    private readonly SymbolDefinition[] _definitions;
    private readonly Symbol8[] _packed;
    private readonly double[] _weights;
    private readonly Dictionary<string, int> _indexBySymbol;
    private readonly Dictionary<Symbol8, int> _indexByPacked;

    private SymbolUniverse(SymbolDefinition[] definitions)
    {
        _definitions = definitions;
        _packed = new Symbol8[definitions.Length];
        _weights = new double[definitions.Length];
        _indexBySymbol = new Dictionary<string, int>(definitions.Length, StringComparer.Ordinal);
        _indexByPacked = new Dictionary<Symbol8, int>(definitions.Length);

        var total = 0d;
        for (var i = 0; i < definitions.Length; i++)
        {
            total += definitions[i].Weight;
        }

        for (var i = 0; i < definitions.Length; i++)
        {
            var definition = definitions[i];
            _packed[i] = definition.Packed;
            _weights[i] = definition.Weight / total;
            _indexBySymbol.Add(definition.Symbol, i);
            _indexByPacked.Add(definition.Packed, i);
        }
    }

    /// <summary>Number of instruments in the universe.</summary>
    internal int Count => _definitions.Length;

    /// <summary>All definitions, ordered by descending <see cref="SymbolDefinition.Weight"/>.</summary>
    internal ReadOnlySpan<SymbolDefinition> Symbols => _definitions;

    /// <summary>
    /// Packed wire symbols, parallel to <see cref="Symbols"/>. Converted once here so the
    /// generator never touches a string.
    /// </summary>
    internal ReadOnlySpan<Symbol8> PackedSymbols => _packed;

    /// <summary>
    /// Activity weights normalised across the whole universe, parallel to <see cref="Symbols"/>
    /// and summing to 1. Feed these straight to <see cref="WeightedSymbolPicker"/>.
    /// </summary>
    internal ReadOnlySpan<double> Weights => _weights;

    /// <summary>The definition at <paramref name="index"/>.</summary>
    internal SymbolDefinition this[int index] => _definitions[index];

    /// <summary>
    /// Loads the universe from the embedded <c>symbols.json</c>, padded to
    /// <paramref name="size"/>.
    /// </summary>
    /// <param name="size">
    /// Total instrument count. Below the number of named symbols the universe is truncated to the
    /// <paramref name="size"/> most active named symbols; above it, the remainder is generated.
    /// </param>
    /// <param name="seed">Seed for the synthetic padding. The same seed yields the same universe.</param>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="size"/> is outside 1..<see cref="MaxSize"/>.</exception>
    /// <exception cref="InvalidDataException">The reference data is missing or malformed.</exception>
    internal static SymbolUniverse Load(int size = DefaultSize, ulong seed = 0)
        => LoadFrom(ReadEmbeddedSymbolsJson(), size, seed, ResourceName);

    /// <summary>
    /// Loads the universe from supplied JSON. Exists so tests and, later, a configured override
    /// file can exercise the same validation the embedded resource goes through.
    /// </summary>
    /// <param name="symbolsJson">Contents of a <c>symbols.json</c> document.</param>
    /// <param name="size">Total instrument count, as for <see cref="Load"/>.</param>
    /// <param name="seed">Seed for the synthetic padding.</param>
    /// <param name="origin">Label used in validation messages to identify the source.</param>
    internal static SymbolUniverse LoadFrom(string symbolsJson, int size, ulong seed, string origin = "symbols.json")
    {
        ArgumentNullException.ThrowIfNull(symbolsJson);
        ArgumentOutOfRangeException.ThrowIfLessThan(size, 1);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(size, MaxSize);

        // Most active first, so index 0 is always the head of the tape and truncating a universe
        // keeps the symbols that matter. OrderByDescending is a stable sort, so equal weights keep
        // file order and the universe is reproducible down to the index.
        var named = ParseNamed(symbolsJson, origin)
            .OrderByDescending(static definition => definition.Weight)
            .ToList();

        if (named.Count > size)
        {
            named.RemoveRange(size, named.Count - size);
        }

        var definitions = new SymbolDefinition[size];
        for (var i = 0; i < named.Count; i++)
        {
            definitions[i] = named[i];
        }

        if (named.Count < size)
        {
            AppendSynthetic(definitions, named.Count, named[^1].Weight, seed);
        }

        AssertNoDuplicates(definitions, origin);
        return new SymbolUniverse(definitions);
    }

    /// <summary>Builds a picker over this universe's normalised weights.</summary>
    internal WeightedSymbolPicker CreatePicker() => new(Weights);

    /// <summary>Looks a symbol up by ticker. Configuration and diagnostics only; never the hot path.</summary>
    internal bool TryGetIndex(string symbol, out int index) => _indexBySymbol.TryGetValue(symbol, out index);

    /// <summary>Looks a symbol up by its packed wire form. Used when decoding, not when generating.</summary>
    internal bool TryGetIndex(Symbol8 symbol, out int index) => _indexByPacked.TryGetValue(symbol, out index);

    private static List<SymbolDefinition> ParseNamed(string symbolsJson, string origin)
    {
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(
                symbolsJson,
                new JsonDocumentOptions { CommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true });
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException($"{origin}: not valid JSON. {exception.Message}", exception);
        }

        using (document)
        {
            if (document.RootElement.ValueKind != JsonValueKind.Object ||
                !document.RootElement.TryGetProperty("symbols", out var array) ||
                array.ValueKind != JsonValueKind.Array)
            {
                throw new InvalidDataException($"{origin}: expected an object with a 'symbols' array at the root.");
            }

            var definitions = new List<SymbolDefinition>(array.GetArrayLength());
            var ordinal = 0;
            foreach (var element in array.EnumerateArray())
            {
                var where = $"{origin}[{ordinal}]";
                if (element.ValueKind != JsonValueKind.Object)
                {
                    throw new InvalidDataException($"{where}: expected an object, found {element.ValueKind}.");
                }

                var definition = new SymbolDefinition
                {
                    Symbol = ReadString(element, "symbol", where),
                    Name = ReadString(element, "name", where),
                    ReferencePrice = ReadDecimal(element, "referencePrice", where),
                    TickSize = ReadDecimal(element, "tickSize", where),
                    LotSize = ReadInt32(element, "lotSize", where),
                    Weight = ReadDouble(element, "weight", where),
                };

                definition.Validate(where);
                definitions.Add(definition.WithPackedSymbol());
                ordinal++;
            }

            if (definitions.Count == 0)
            {
                throw new InvalidDataException($"{origin}: the 'symbols' array is empty; the universe needs at least one named symbol.");
            }

            return definitions;
        }
    }

    /// <summary>
    /// Fills <paramref name="definitions"/> from <paramref name="start"/> with deterministic
    /// <c>SYNnnnn</c> padding: prices drawn from the seed, weights from a Zipf tail so each one is
    /// individually rare.
    /// </summary>
    private static void AppendSynthetic(SymbolDefinition[] definitions, int start, double leastNamedWeight, ulong seed)
    {
        // Mixed with a constant so this stream cannot coincide with the price generator's stream
        // (task 03) when both are handed the same run seed.
        var random = new SplitMix64(seed ^ 0x5359_4E54_4943_4B52UL);
        var headWeight = leastNamedWeight * SyntheticHeadFactor;

        for (var i = start; i < definitions.Length; i++)
        {
            var rank = i - start + 1;
            var symbol = string.Create(
                CultureInfo.InvariantCulture,
                $"{SyntheticPrefix}{rank:D4}");

            var price = QuantiseToTick(
                SyntheticMinPrice + ((decimal)random.NextDouble() * (SyntheticMaxPrice - SyntheticMinPrice)));

            var definition = new SymbolDefinition
            {
                Symbol = symbol,
                Name = $"Synthetic Instrument {rank:D4}",
                ReferencePrice = price,
                TickSize = TickSizeFor(price),
                LotSize = LotSizeFor(price),
                Weight = headWeight / Math.Pow(rank, SyntheticZipfExponent),
            };

            definition.Validate("synthetic padding");
            definitions[i] = definition.WithPackedSymbol();
        }
    }

    /// <summary>
    /// Banded tick sizes, matching the convention documented in <c>symbols.json</c>.
    /// </summary>
    private static decimal TickSizeFor(decimal price) => price switch
    {
        < 10.00m => 0.001m,
        < 50.00m => 0.01m,
        < 200.00m => 0.05m,
        _ => 0.10m,
    };

    private static int LotSizeFor(decimal price) => price switch
    {
        < 3.00m => 1_000,
        < 10.00m => 500,
        < 200.00m => 100,
        _ => 10,
    };

    /// <summary>Snaps a price onto its band's tick grid, keeping it strictly positive.</summary>
    private static decimal QuantiseToTick(decimal price)
    {
        // Rounding can carry a price across a band boundary (9.9996 -> 10.00), so re-derive the
        // band from the snapped value and snap once more; the second pass is always a fixed point.
        var snapped = Snap(price, TickSizeFor(price));
        snapped = Snap(snapped, TickSizeFor(snapped));
        return snapped;

        static decimal Snap(decimal value, decimal tick)
        {
            var ticks = Math.Round(value / tick, MidpointRounding.AwayFromZero);
            return Math.Max(tick, ticks * tick);
        }
    }

    private static void AssertNoDuplicates(SymbolDefinition[] definitions, string origin)
    {
        var seen = new HashSet<string>(definitions.Length, StringComparer.Ordinal);
        foreach (var definition in definitions)
        {
            if (!seen.Add(definition.Symbol))
            {
                throw new InvalidDataException(
                    $"{origin}: symbol '{definition.Symbol}' is listed more than once. " +
                    "Duplicate tickers would give one instrument two independent price paths.");
            }
        }
    }

    private static string ReadEmbeddedSymbolsJson()
    {
        var assembly = typeof(SymbolUniverse).Assembly;

        using (var stream = assembly.GetManifestResourceStream(ResourceName))
        {
            if (stream is not null)
            {
                using var reader = new StreamReader(stream);
                return reader.ReadToEnd();
            }
        }

        // Fallback: the SDK copies the file next to the assembly as content. Task 02 does not own
        // the csproj, so the <EmbeddedResource> entry is a pending request to task 06; until it
        // lands, this path is the one that runs. Both are load-time only.
        var contentPath = Path.Combine(AppContext.BaseDirectory, "Reference", "symbols.json");
        if (File.Exists(contentPath))
        {
            return File.ReadAllText(contentPath);
        }

        throw new InvalidDataException(
            $"Reference data is missing: neither the embedded resource '{ResourceName}' nor the file " +
            $"'{contentPath}' could be found. The mock exchange cannot start without a symbol universe.");
    }

    private static string ReadString(JsonElement element, string property, string where)
    {
        if (!element.TryGetProperty(property, out var value) || value.ValueKind != JsonValueKind.String)
        {
            throw new InvalidDataException($"{where}: missing or non-string '{property}'.");
        }

        return value.GetString()!;
    }

    private static decimal ReadDecimal(JsonElement element, string property, string where)
    {
        if (!element.TryGetProperty(property, out var value) ||
            value.ValueKind != JsonValueKind.Number ||
            !value.TryGetDecimal(out var number))
        {
            throw new InvalidDataException($"{where}: missing or non-numeric '{property}'.");
        }

        return number;
    }

    private static int ReadInt32(JsonElement element, string property, string where)
    {
        if (!element.TryGetProperty(property, out var value) ||
            value.ValueKind != JsonValueKind.Number ||
            !value.TryGetInt32(out var number))
        {
            throw new InvalidDataException($"{where}: missing or non-integer '{property}'.");
        }

        return number;
    }

    private static double ReadDouble(JsonElement element, string property, string where)
    {
        if (!element.TryGetProperty(property, out var value) ||
            value.ValueKind != JsonValueKind.Number ||
            !value.TryGetDouble(out var number))
        {
            throw new InvalidDataException($"{where}: missing or non-numeric '{property}'.");
        }

        return number;
    }

    /// <summary>
    /// SplitMix64, used only to make the synthetic padding reproducible from a seed.
    /// </summary>
    /// <remarks>
    /// Deliberately local to this file rather than shared with the generation engine: this stream
    /// runs once at load time, and coupling it to the hot-path generator would mean a change to
    /// either one silently reshapes the other's output.
    /// </remarks>
    private struct SplitMix64(ulong seed)
    {
        private ulong _state = seed;

        internal ulong NextUInt64()
        {
            var z = _state += 0x9E37_79B9_7F4A_7C15UL;
            z = (z ^ (z >> 30)) * 0xBF58_476D_1CE4_E5B9UL;
            z = (z ^ (z >> 27)) * 0x94D0_49BB_1331_11EBUL;
            return z ^ (z >> 31);
        }

        /// <summary>A uniform double in [0, 1), from the top 53 bits.</summary>
        internal double NextDouble() => (NextUInt64() >> 11) * (1.0 / 9_007_199_254_740_992.0);
    }
}
