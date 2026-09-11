using System.Net;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Tckr.MockExchange.Feed;

namespace Tckr.MockExchange.Tests.Host;

/// <summary>
/// Builds a host through the process's own <see cref="MockExchangeServiceCollectionExtensions"/>,
/// from an in-memory configuration instead of <c>appsettings.json</c>.
/// </summary>
/// <remarks>
/// The wiring under test is deliberately the real one. A test that assembles its own service
/// collection proves the components compose, which is not the question — the question is whether
/// <c>Program.cs</c> does, and the only way to answer it is to run the same call it makes.
/// <para>
/// Every host binds port 0 unless a test says otherwise, so the suite stays parallel-safe.
/// </para>
/// </remarks>
internal static class MockExchangeHostHarness
{
    /// <summary>Configuration that starts a quiet, loopback-only exchange on an ephemeral port.</summary>
    internal static Dictionary<string, string?> Defaults() => new()
    {
        ["MockExchange:Generation:Seed"] = "20260907",
        ["MockExchange:Generation:UniverseSize"] = "50",
        ["MockExchange:Session:Mode"] = "Continuous",
        ["MockExchange:Session:BaseEventsPerSecond"] = "1000",
        ["MockExchange:Session:MaxEventsPerSecond"] = "100000",
        ["MockExchange:Session:BatchIntervalMs"] = "5",
        ["MockExchange:Session:TimeZone"] = "UTC",
        ["MockExchange:Feed:ListenAddress"] = "127.0.0.1",
        ["MockExchange:Feed:Port"] = "0",
        ["MockExchange:Feed:HeartbeatIntervalMs"] = "60000",

        // The status line is a hosted service on a timer. Tests that are not about it want it
        // silent rather than interleaved with whatever they are asserting on.
        ["MockExchange:Diagnostics:ThroughputReportIntervalSeconds"] = "3600",
    };

    /// <summary>Builds a host over <paramref name="settings"/>, with no file or environment providers.</summary>
    internal static IHost Build(
        IDictionary<string, string?> settings,
        Action<IConfigurationBuilder>? configureConfiguration = null,
        LogLevel minimumLevel = LogLevel.Warning)
    {
        HostApplicationBuilder builder = Microsoft.Extensions.Hosting.Host.CreateEmptyApplicationBuilder(new());

        builder.Configuration.AddInMemoryCollection(settings);
        configureConfiguration?.Invoke(builder.Configuration);

        builder.Services.AddLogging(logging => logging.SetMinimumLevel(minimumLevel));
        builder.Services.AddMockExchange(builder.Configuration);

        // An empty builder still takes ConsoleLifetime by default, which hooks Ctrl+C for the whole
        // test process. Registered after AddMockExchange so this last registration is the one
        // resolved.
        builder.Services.AddSingleton<IHostLifetime, NoopHostLifetime>();

        return builder.Build();
    }

    /// <summary>Builds a host with one setting changed from <see cref="Defaults"/>.</summary>
    internal static IHost BuildWith(string key, string? value)
    {
        Dictionary<string, string?> settings = Defaults();
        settings[key] = value;
        return Build(settings);
    }

    /// <summary>The endpoint the running host actually bound, which with port 0 is not the configured one.</summary>
    internal static IPEndPoint EndPointOf(IHost host) =>
        host.Services.GetRequiredService<FeedServer>().LocalEndPoint
        ?? throw new InvalidOperationException("The feed server has not bound a port.");

    /// <summary>A lifetime that does nothing, so a test host does not touch the console.</summary>
    private sealed class NoopHostLifetime : IHostLifetime
    {
        public Task WaitForStartAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    }
}
