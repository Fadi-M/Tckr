using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Tckr.MockExchange.Diagnostics;
using Tckr.MockExchange.Feed;
using Tckr.MockExchange.Generation;
using Tckr.MockExchange.Options;
using Tckr.MockExchange.Reference;
using Tckr.MockExchange.Session;

namespace Tckr.MockExchange;

/// <summary>
/// The whole composition of the mock exchange, in one place.
/// </summary>
/// <remarks>
/// Separate from <c>Program.cs</c> so the tests can start the <em>real</em> wiring rather than a
/// second copy of it that agrees with the first only until someone changes one of them. A test
/// that builds its own service collection proves the components compose; it does not prove the
/// process does.
/// </remarks>
internal static class MockExchangeServiceCollectionExtensions
{
    /// <summary>
    /// Binds and validates the <c>MockExchange</c> section and registers every component the
    /// worker runs.
    /// </summary>
    internal static IServiceCollection AddMockExchange(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        services
            .AddOptions<MockExchangeOptions>()

            // Registered before Bind, and the order is the whole point: IConfigureOptions runs in
            // registration order, so this clears the default schedule before the binder reaches it.
            // Microsoft.Extensions.Configuration *appends* to a non-empty collection rather than
            // replacing it, so without this a configured six-phase schedule binds on top of the
            // six-phase default and every window overlaps its own duplicate.
            .Configure(options => ReplaceDefaultPhaseSchedule(options, configuration))

            .Bind(configuration.GetSection(MockExchangeOptions.SectionName))
            .ValidateDataAnnotations()
            .ValidateOnStart();

        // ValidateDataAnnotations only reaches the root object's own properties. The nested
        // sections carry all of the interesting bounds, plus the cross-field rules no attribute
        // can express, so the real validation is here. It takes the raw configuration too, because
        // some of what can go wrong is invisible on the bound object.
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IValidateOptions<MockExchangeOptions>>(
            new MockExchangeOptionsValidator(configuration)));

        services.TryAddSingleton(TimeProvider.System);

        // One instance, two service types. Registering FeedMetrics twice would give the server and
        // the reporter separate meters and split every counter between them.
        services.TryAddSingleton(sp => new FeedMetrics(sp.GetRequiredService<TimeProvider>()));
        services.TryAddSingleton<IFeedServerMetrics>(sp => sp.GetRequiredService<FeedMetrics>());

        services.TryAddSingleton(sp =>
        {
            GenerationOptions generation = sp.GetRequiredService<IOptions<MockExchangeOptions>>().Value.Generation;
            return SymbolUniverse.Load(generation.UniverseSize, generation.Seed);
        });

        services.TryAddSingleton<IMarketDataGenerator>(sp => new RandomWalkGenerator(
            sp.GetRequiredService<SymbolUniverse>(),
            sp.GetRequiredService<IOptions<MockExchangeOptions>>().Value.Generation,
            sp.GetRequiredService<TimeProvider>()));

        services.TryAddSingleton(sp => new MarketSessionClock(
            sp.GetRequiredService<IOptions<MockExchangeOptions>>().Value.Session,
            sp.GetRequiredService<TimeProvider>(),
            sp.GetRequiredService<ILogger<MarketSessionClock>>()));

        services.TryAddSingleton(sp =>
        {
            MarketSessionOptions session = sp.GetRequiredService<IOptions<MockExchangeOptions>>().Value.Session;
            return new RateGovernor(
                session.BatchIntervalMs,
                session.MaxCatchUpBatches,
                sp.GetRequiredService<TimeProvider>(),
                sp.GetRequiredService<ILogger<RateGovernor>>());
        });

        services.TryAddSingleton(sp => new FeedServer(
            sp.GetRequiredService<IOptions<MockExchangeOptions>>().Value.Feed,
            sp.GetRequiredService<ILogger<FeedServer>>(),
            sp.GetRequiredService<IFeedServerMetrics>(),
            sp.GetRequiredService<TimeProvider>()));

        services.AddHostedService(sp => new ThroughputReporter(
            sp.GetRequiredService<FeedMetrics>(),
            sp.GetRequiredService<ILogger<ThroughputReporter>>(),
            sp.GetRequiredService<TimeProvider>(),
            sp.GetRequiredService<IOptions<MockExchangeOptions>>().Value.Diagnostics.ThroughputReportIntervalSeconds));

        // Registered last, and it owns the feed server's start/stop ordering itself rather than
        // depending on this line staying last.
        services.AddHostedService<FeedPublisherService>();

        return services;
    }

    /// <summary>
    /// Empties the default phase schedule when the configuration supplies one of its own.
    /// </summary>
    /// <remarks>
    /// <see cref="MarketSessionOptions.Phases"/> defaults to a full six-phase day, which is the
    /// right default for a type constructed in code and a trap for one bound from configuration:
    /// the binder adds to a collection it finds populated instead of replacing it. Leaving the
    /// default in place turns a perfectly ordinary <c>appsettings.json</c> schedule into twelve
    /// windows that all overlap. Clearing it only when the section actually has entries keeps the
    /// default meaningful for a configuration that says nothing about phases.
    /// </remarks>
    private static void ReplaceDefaultPhaseSchedule(MockExchangeOptions options, IConfiguration configuration)
    {
        IConfigurationSection phases = configuration.GetSection($"{MarketSessionOptions.SectionName}:Phases");

        if (phases.GetChildren().Any())
        {
            options.Session.Phases.Clear();
        }
    }
}
