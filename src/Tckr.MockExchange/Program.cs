// Tckr.MockExchange — simulates the exchange market-data feed.
//
// Configuration lives under the "MockExchange" section of appsettings.json and is overridable by
// environment variable through the standard double-underscore convention, so a benchmark can sweep
// the rate without editing a file:
//
//     MockExchange__Session__BaseEventsPerSecond=25000 dotnet run --project src/Tckr.MockExchange

using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Tckr.MockExchange;

HostApplicationBuilder builder = Host.CreateApplicationBuilder(args);

builder.Services.AddMockExchange(builder.Configuration);

IHost host = builder.Build();
await host.RunAsync();
