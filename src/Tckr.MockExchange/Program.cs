// Tckr.MockExchange — simulates the exchange market-data feed.
//
// Scaffold only. The publisher loop, options binding and DI wiring are built by
// Phase 2, task 06: docs/phase-2-mock-exchange/06-configuration-and-host.md

var builder = Host.CreateApplicationBuilder(args);

var host = builder.Build();
await host.RunAsync();
