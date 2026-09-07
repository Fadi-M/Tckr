using Tckr.MockExchange.Protocol;

namespace Tckr.MockExchange.Tests.Protocol;

public class PriceScaleTests
{
    [Theory]
    [InlineData("85.10", 851_000L)]
    [InlineData("0.0001", 1L)]
    [InlineData("999999.9999", 9_999_999_999L)]
    [InlineData("0", 0L)]
    [InlineData("-12.3456", -123_456L)]
    public void ScalesAndRestoresExactly(string text, long expectedScaled)
    {
        decimal price = decimal.Parse(text, System.Globalization.CultureInfo.InvariantCulture);

        long scaled = PriceScale.ToScaled(price);

        scaled.ShouldBe(expectedScaled);
        PriceScale.FromScaled(scaled).ShouldBe(price);
    }

    [Theory]
    [InlineData("85.10005", 851_001L)]  // half rounds away from zero, not to even
    [InlineData("85.10015", 851_002L)]  // ... in both directions, unlike banker's rounding
    [InlineData("-85.10005", -851_001L)]
    [InlineData("85.100049", 851_000L)]
    public void RoundsHalfAwayFromZeroBeyondFourDecimals(string text, long expectedScaled)
    {
        decimal price = decimal.Parse(text, System.Globalization.CultureInfo.InvariantCulture);

        PriceScale.ToScaled(price).ShouldBe(expectedScaled);
    }

    [Fact]
    public void ThrowsWhenTheScaledPriceCannotFitInSixtyFourBits()
    {
        Should.Throw<OverflowException>(() => PriceScale.ToScaled(decimal.MaxValue));
        Should.Throw<OverflowException>(() => PriceScale.ToScaled(1_000_000_000_000_000m));
    }

    [Fact]
    public void ConstantsAgree()
    {
        PriceScale.Decimals.ShouldBe(4);
        PriceScale.Factor.ShouldBe(10_000L);
    }
}
