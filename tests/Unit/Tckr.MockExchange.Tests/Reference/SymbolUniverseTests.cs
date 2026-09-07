using System.Text.Json;
using Tckr.MockExchange.Protocol;
using Tckr.MockExchange.Reference;

namespace Tckr.MockExchange.Tests.Reference;

public class SymbolUniverseTests
{
    private const ulong Seed = 0xC0FFEE_1234_5678UL;

    [Fact]
    public void EmbeddedSymbolsJson_LoadsAndPassesValidation()
    {
        var universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, Seed);

        universe.Count.ShouldBe(SymbolUniverse.DefaultSize);

        // Validate() is what Load() already ran; re-running it documents the contract and would
        // throw on any field that survived construction unset.
        var validated = 0;
        foreach (var definition in universe.Symbols)
        {
            definition.Validate("universe");
            validated++;
        }

        validated.ShouldBe(SymbolUniverse.DefaultSize);
    }

    [Fact]
    public void EmbeddedSymbolsJson_ContainsAtLeastThirtyNamedSymbols()
    {
        // Load a universe with no padding room so Count is exactly the named-symbol count.
        var named = NamedSymbolCount();

        named.ShouldBeGreaterThanOrEqualTo(30);
    }

    [Theory]
    [InlineData("COMI")]
    [InlineData("CIB")]
    [InlineData("ORAS")]
    [InlineData("SWDY")]
    public void MasterContextSymbols_ArePresent(string symbol)
    {
        var universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, Seed);

        universe.TryGetIndex(symbol, out var index).ShouldBeTrue($"'{symbol}' must be in the universe.");
        universe[index].Symbol.ShouldBe(symbol);
    }

    [Fact]
    public void Comi_IsTheMostActiveSymbol()
    {
        // The master context's example of a hot symbol. Index 0 is the head of the tape.
        var universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, Seed);

        universe[0].Symbol.ShouldBe("COMI");
    }

    [Fact]
    public void PackedSymbol_IsConvertedOnceAtLoadTime()
    {
        var universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, Seed);

        for (var i = 0; i < universe.Count; i++)
        {
            universe.PackedSymbols[i].ShouldBe(Symbol8.FromAscii(universe[i].Symbol));
            universe[i].Packed.ShouldBe(universe.PackedSymbols[i]);
        }
    }

    [Fact]
    public void TryGetIndex_ResolvesByPackedSymbolAsWellAsByString()
    {
        var universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, Seed);

        universe.TryGetIndex(Symbol8.FromAscii("ORAS"), out var packedIndex).ShouldBeTrue();
        universe.TryGetIndex("ORAS", out var stringIndex).ShouldBeTrue();

        packedIndex.ShouldBe(stringIndex);
    }

    [Fact]
    public void TryGetIndex_ReturnsFalseForAnUnlistedSymbol()
    {
        var universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, Seed);

        universe.TryGetIndex("NOTLISTD", out var index).ShouldBeFalse();
        index.ShouldBe(0);
    }

    [Fact]
    public void DefaultUniverse_HasExactlyTwoHundredAndFiftyUniqueSymbols()
    {
        var universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, Seed);

        universe.Count.ShouldBe(250);

        var unique = new HashSet<string>(StringComparer.Ordinal);
        var uniquePacked = new HashSet<Symbol8>();
        foreach (var definition in universe.Symbols)
        {
            unique.Add(definition.Symbol).ShouldBeTrue($"'{definition.Symbol}' appears twice.");
            uniquePacked.Add(definition.Packed).ShouldBeTrue($"'{definition.Symbol}' packs to a used value.");
        }

        unique.Count.ShouldBe(250);
    }

    [Fact]
    public void SyntheticPadding_FillsTheRemainderOfTheUniverse()
    {
        var named = NamedSymbolCount();
        var universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, Seed);

        var synthetic = 0;
        foreach (var definition in universe.Symbols)
        {
            if (definition.Symbol.StartsWith(SymbolUniverse.SyntheticPrefix, StringComparison.Ordinal))
            {
                synthetic++;
                definition.ReferencePrice.ShouldBeInRange(5.00m, 500.00m);
            }
        }

        synthetic.ShouldBe(SymbolUniverse.DefaultSize - named);
    }

    [Fact]
    public void SameSeed_ProducesAnIdenticalUniverse()
    {
        var first = SymbolUniverse.Load(SymbolUniverse.DefaultSize, Seed);
        var second = SymbolUniverse.Load(SymbolUniverse.DefaultSize, Seed);

        first.Count.ShouldBe(second.Count);
        for (var i = 0; i < first.Count; i++)
        {
            var a = first[i];
            var b = second[i];

            a.Symbol.ShouldBe(b.Symbol);
            a.Name.ShouldBe(b.Name);
            a.ReferencePrice.ShouldBe(b.ReferencePrice);
            a.TickSize.ShouldBe(b.TickSize);
            a.LotSize.ShouldBe(b.LotSize);
            a.Weight.ShouldBe(b.Weight);
            a.Packed.ShouldBe(b.Packed);
            first.Weights[i].ShouldBe(second.Weights[i]);
        }
    }

    [Fact]
    public void DifferentSeed_ChangesTheSyntheticPricesButNotTheTickers()
    {
        var first = SymbolUniverse.Load(SymbolUniverse.DefaultSize, Seed);
        var second = SymbolUniverse.Load(SymbolUniverse.DefaultSize, Seed + 1);

        var differences = 0;
        for (var i = 0; i < first.Count; i++)
        {
            first[i].Symbol.ShouldBe(second[i].Symbol);
            if (first[i].ReferencePrice != second[i].ReferencePrice)
            {
                differences++;
            }
        }

        differences.ShouldBeGreaterThan(100, "a different seed must redraw the synthetic prices.");
    }

    [Fact]
    public void EveryPrice_IsAnExactMultipleOfItsTickSize()
    {
        var universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, Seed);

        foreach (var definition in universe.Symbols)
        {
            (definition.ReferencePrice % definition.TickSize)
                .ShouldBe(0m, $"{definition.Symbol} at {definition.ReferencePrice} is off the {definition.TickSize} tick grid.");
        }
    }

    [Fact]
    public void NamedPrices_SpanSeveralOrdersOfMagnitude()
    {
        var universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, Seed);

        var min = decimal.MaxValue;
        var max = decimal.MinValue;
        foreach (var definition in universe.Symbols)
        {
            if (definition.Symbol.StartsWith(SymbolUniverse.SyntheticPrefix, StringComparison.Ordinal))
            {
                continue;
            }

            min = Math.Min(min, definition.ReferencePrice);
            max = Math.Max(max, definition.ReferencePrice);
        }

        min.ShouldBeLessThan(10m);
        max.ShouldBeGreaterThan(200m);
    }

    [Fact]
    public void Weights_AreNormalisedAndAllStrictlyPositive()
    {
        var universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, Seed);

        var total = 0d;
        foreach (var weight in universe.Weights)
        {
            weight.ShouldBeGreaterThan(0d);
            total += weight;
        }

        total.ShouldBe(1d, 1e-12);
    }

    [Fact]
    public void Weights_AreOrderedMostActiveFirst()
    {
        var universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, Seed);

        for (var i = 1; i < universe.Count; i++)
        {
            universe.Weights[i].ShouldBeLessThanOrEqualTo(universe.Weights[i - 1]);
        }
    }

    [Fact]
    public void SyntheticSymbols_AreAllRarerThanEveryNamedSymbol()
    {
        var named = NamedSymbolCount();
        var universe = SymbolUniverse.Load(SymbolUniverse.DefaultSize, Seed);

        for (var i = 0; i < named; i++)
        {
            universe[i].Symbol.ShouldNotStartWith(SymbolUniverse.SyntheticPrefix);
        }

        for (var i = named; i < universe.Count; i++)
        {
            universe[i].Symbol.ShouldStartWith(SymbolUniverse.SyntheticPrefix);
        }
    }

    [Fact]
    public void SizeSmallerThanTheNamedSet_KeepsTheMostActiveSymbols()
    {
        var universe = SymbolUniverse.Load(5, Seed);

        universe.Count.ShouldBe(5);
        universe[0].Symbol.ShouldBe("COMI");
        universe.TryGetIndex("BINV", out _).ShouldBeFalse("the least active named symbol must be the first dropped.");
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(SymbolUniverse.MaxSize + 1)]
    public void OutOfRangeSize_IsRejected(int size)
        => Should.Throw<ArgumentOutOfRangeException>(() => SymbolUniverse.Load(size, Seed));

    [Fact]
    public void DuplicateSymbol_FailsLoudly()
    {
        var json = Universe(
            Entry("COMI", price: "85.10", tick: "0.05", lot: 100, weight: 100),
            Entry("COMI", price: "12.00", tick: "0.01", lot: 100, weight: 50));

        var exception = Should.Throw<InvalidDataException>(() => SymbolUniverse.LoadFrom(json, 2, Seed));

        exception.Message.ShouldContain("COMI");
        exception.Message.ShouldContain("more than once");
    }

    [Theory]
    [InlineData("comi", "lowercase")]
    [InlineData("BRK.B", "a dot")]
    [InlineData("TOOLONGSYM", "more than eight characters")]
    [InlineData("", "empty")]
    [InlineData("A B", "a space")]
    public void InvalidSymbol_FailsWithAUsefulMessage(string symbol, string why)
    {
        var json = Universe(Entry(symbol, price: "10.00", tick: "0.01", lot: 100, weight: 1));

        var exception = Should.Throw<InvalidDataException>(() => SymbolUniverse.LoadFrom(json, 1, Seed));

        // The message must name the offender and state the rule; '{why}' documents the case.
        why.ShouldNotBeEmpty();
        exception.Message.ShouldContain(symbol);
        exception.Message.ShouldContain("^[A-Z0-9]{1,8}$");
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-1.5")]
    public void NonPositivePrice_FailsWithAUsefulMessage(string price)
    {
        var json = Universe(Entry("COMI", price, tick: "0.01", lot: 100, weight: 1));

        var exception = Should.Throw<InvalidDataException>(() => SymbolUniverse.LoadFrom(json, 1, Seed));

        exception.Message.ShouldContain("COMI");
        exception.Message.ShouldContain("referencePrice");
        exception.Message.ShouldContain("greater than zero");
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-0.01")]
    public void NonPositiveTickSize_FailsWithAUsefulMessage(string tick)
    {
        var json = Universe(Entry("COMI", price: "10.00", tick, lot: 100, weight: 1));

        var exception = Should.Throw<InvalidDataException>(() => SymbolUniverse.LoadFrom(json, 1, Seed));

        exception.Message.ShouldContain("tickSize");
        exception.Message.ShouldContain("greater than zero");
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-100)]
    public void NonPositiveLotSize_FailsWithAUsefulMessage(int lot)
    {
        var json = Universe(Entry("COMI", price: "10.00", tick: "0.01", lot, weight: 1));

        var exception = Should.Throw<InvalidDataException>(() => SymbolUniverse.LoadFrom(json, 1, Seed));

        exception.Message.ShouldContain("lotSize");
        exception.Message.ShouldContain("greater than zero");
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-4")]
    public void NonPositiveWeight_FailsWithAUsefulMessage(string weight)
    {
        var json = Universe($$"""
                              { "symbol": "COMI", "name": "Example", "referencePrice": 10.00,
                                "tickSize": 0.01, "lotSize": 100, "weight": {{weight}} }
                              """);

        var exception = Should.Throw<InvalidDataException>(() => SymbolUniverse.LoadFrom(json, 1, Seed));

        exception.Message.ShouldContain("COMI");
        exception.Message.ShouldContain("weight");
        exception.Message.ShouldContain("greater than zero");
    }

    [Fact]
    public void MissingField_FailsWithAUsefulMessage()
    {
        var json = Universe("""{ "symbol": "COMI", "name": "Example", "tickSize": 0.01, "lotSize": 100, "weight": 1 }""");

        var exception = Should.Throw<InvalidDataException>(() => SymbolUniverse.LoadFrom(json, 1, Seed));

        exception.Message.ShouldContain("referencePrice");
    }

    [Fact]
    public void MalformedJson_FailsWithAUsefulMessage()
    {
        var exception = Should.Throw<InvalidDataException>(() => SymbolUniverse.LoadFrom("{ not json", 1, Seed));

        exception.Message.ShouldContain("not valid JSON");
    }

    [Fact]
    public void MissingSymbolsArray_FailsWithAUsefulMessage()
    {
        var exception = Should.Throw<InvalidDataException>(() => SymbolUniverse.LoadFrom("""{ "instruments": [] }""", 1, Seed));

        exception.Message.ShouldContain("'symbols' array");
    }

    [Fact]
    public void EmptySymbolsArray_FailsWithAUsefulMessage()
    {
        var exception = Should.Throw<InvalidDataException>(() => SymbolUniverse.LoadFrom("""{ "symbols": [] }""", 1, Seed));

        exception.Message.ShouldContain("at least one named symbol");
    }

    private static int NamedSymbolCount()
    {
        // Read the embedded document directly rather than hard-coding the count, so adding a
        // ticker to symbols.json does not break unrelated tests.
        using var stream = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "Reference", "symbols.json"));
        using var document = JsonDocument.Parse(stream);
        return document.RootElement.GetProperty("symbols").GetArrayLength();
    }

    private static string Universe(params string[] entries) => $$"""{ "symbols": [ {{string.Join(",\n", entries)}} ] }""";

    private static string Entry(string symbol, string price, string tick, int lot, int weight)
        => $$"""
             { "symbol": "{{symbol}}", "name": "Example Instrument", "referencePrice": {{price}},
               "tickSize": {{tick}}, "lotSize": {{lot}}, "weight": {{weight}} }
             """;
}
