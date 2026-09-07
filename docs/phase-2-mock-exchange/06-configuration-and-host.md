# Task 06 — Configuration, DI Wiring & Publisher Loop

| | |
|---|---|
| **Phase** | 2 — Mock Exchange |
| **Status** | Not started |
| **Depends on** | 03, 04, 05 (07 if available) |
| **Blocks** | 09 |
| **Parallel with** | 07, 08 |
| **Owns** | `src/Tckr.MockExchange/Options/**`, `Program.cs`, `FeedPublisherService.cs`, `appsettings*.json`, `Tckr.MockExchange.csproj`, `src/Tckr.slnx` |

> **Scaffolding is already done.** The test project (`tests/Unit/Tckr.MockExchange.Tests`,
> xUnit + Shouldly + `FakeTimeProvider` + `MetricCollector`), the probe project
> (`tools/Tckr.FeedProbe`), both `InternalsVisibleTo` entries, the empty area folders under
> `src/Tckr.MockExchange/`, and the `src/Tckr.slnx` registrations all exist and build.
> Add your files into the existing structure; do not re-create projects or touch the
> solution file.

---

## Objective

Assemble the parts into a running worker: bind and validate configuration, wire
dependency injection, and run the loop that ties the rate governor, the generator and the
feed server together.

This is the integration task. It also removes the last of the project template.

---

## Specification

### Options

All under `src/Tckr.MockExchange/Options/`, bound from the `MockExchange` configuration
section, validated with `ValidateDataAnnotations()` **and** `ValidateOnStart()`. A bad
configuration must fail at startup with a readable message, not at 03:00 in the middle of
a benchmark run.

```jsonc
{
  "MockExchange": {
    "Seed": 20260907,                 // 0 = random, logged at startup either way

    "Generation": {
      "UniverseSize": 250,            // 1..10000
      "MaxTickMove": 3,               // 1..20
      "TradeRatio": 0.40,             // ratios must sum to 1.0
      "BidQuoteRatio": 0.30,
      "AskQuoteRatio": 0.30,
      "BlockTradeProbability": 0.01,
      "DailyPriceBandPercent": 10.0
    },

    "Session": {
      "Mode": "Continuous",           // Continuous | Scheduled | CompressedDay
      "BaseEventsPerSecond": 25000,   // 1..1000000
      "MaxEventsPerSecond": 100000,
      "BatchIntervalMs": 5,           // 1..100
      "MaxCatchUpBatches": 4,
      "TimeZone": "Africa/Cairo",
      "CompressedDurationMinutes": 5,
      "Phases": [
        { "Phase": "PreOpen",             "Start": "09:30", "End": "10:00", "RateMultiplier": 0.10 },
        { "Phase": "OpeningAuction",      "Start": "10:00", "End": "10:05", "RateMultiplier": 3.00 },
        { "Phase": "ContinuousMorning",   "Start": "10:05", "End": "12:00", "RateMultiplier": 1.20 },
        { "Phase": "MiddayLull",          "Start": "12:00", "End": "13:30", "RateMultiplier": 0.60 },
        { "Phase": "ContinuousAfternoon", "Start": "13:30", "End": "14:15", "RateMultiplier": 1.00 },
        { "Phase": "ClosingAuction",      "Start": "14:15", "End": "14:30", "RateMultiplier": 2.50 }
      ]
    },

    "Feed": {
      "ListenAddress": "0.0.0.0",
      "Port": 9001,
      "MaxSessions": 8,
      "SessionBufferBytes": 4194304,
      "SlowConsumerPolicy": "Disconnect",   // Disconnect | DropOldest
      "SlowConsumerTimeoutMs": 2000,
      "HeartbeatIntervalMs": 1000,
      "SendBufferSize": 262144,
      "ShutdownFlushTimeoutMs": 2000
    },

    "Diagnostics": {
      "ThroughputReportIntervalSeconds": 5
    }
  }
}
```

Validation rules worth enforcing explicitly: the three message ratios sum to `1.0` within
a small epsilon; phase windows do not overlap and are ordered; `MaxEventsPerSecond >=
BaseEventsPerSecond`; the timezone resolves on this platform.

`appsettings.Development.json` should override to something friendlier for laptops —
`BaseEventsPerSecond: 1000`, `UniverseSize: 50` — so `dotnet run` is instant and quiet.

Every setting must also be overridable by environment variable
(`MockExchange__Session__BaseEventsPerSecond=25000`) so task 09 can sweep rates without
editing files. This falls out of the default configuration providers; verify it works and
document the pattern in the README.

### `FeedPublisherService`

Delete the template `Worker.cs`. The replacement is a `BackgroundService` running one
dedicated long-running loop:

```csharp
protected override async Task ExecuteAsync(CancellationToken ct)
{
    var batch = new FeedRecord[maxBatchSize];   // allocated once

    while (!ct.IsCancellationRequested)
    {
        sessionClock.Advance(timeProvider.GetUtcNow());
        var rate  = sessionClock.EffectiveEventsPerSecond(options.BaseEventsPerSecond);
        var count = await rateGovernor.WaitForNextBatchAsync(rate, ct);
        if (count == 0) continue;

        var span = batch.AsSpan(0, Math.Min(count, batch.Length));
        generator.Generate(span);
        feedServer.Publish(span);
        metrics.RecordBatch(span.Length);
    }
}
```

Requirements:

- The batch array is allocated **once**. Size it for the clamped maximum rate:
  `MaxEventsPerSecond × BatchIntervalMs / 1000`, plus catch-up headroom.
- Run on a dedicated thread with `TaskCreationOptions.LongRunning` semantics, not a
  thread-pool work item — this loop occupies its thread by design and will starve the
  pool otherwise.
- If `count` exceeds the batch array, emit in multiple passes rather than reallocating.
- Log at startup: seed, universe size, target rate, mode, listen endpoint. Someone
  reading a benchmark log six weeks later must be able to reconstruct the run.
- Handle `OperationCanceledException` as normal shutdown, not as an error.

### DI wiring in `Program.cs`

```csharp
var builder = Host.CreateApplicationBuilder(args);

builder.Services
    .AddOptions<MockExchangeOptions>()
    .Bind(builder.Configuration.GetSection("MockExchange"))
    .ValidateDataAnnotations()
    .ValidateOnStart();

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<SymbolUniverse>(sp => /* Load(size, seed) */);
builder.Services.AddSingleton<IMarketDataGenerator, RandomWalkGenerator>();
builder.Services.AddSingleton<MarketSessionClock>();
builder.Services.AddSingleton<RateGovernor>();
builder.Services.AddSingleton<FeedServer>();
builder.Services.AddSingleton<FeedMetrics>();          // task 07
builder.Services.AddHostedService<ThroughputReporter>(); // task 07
builder.Services.AddHostedService<FeedPublisherService>();

builder.Host.UseConsoleLifetime();
await builder.Build().RunAsync();
```

`FeedServer` must start listening before the publisher loop starts and stop after it —
order the hosted services accordingly, or start the listener from within the publisher's
`StartAsync`.

If task 07 has not landed, wire a no-op metrics implementation behind the same interface
and note it.

### Inbound requests from completed tasks

Collected here so they are not missed. Each is a change in a file **you** own, requested by a
task that does not own it. The originating task's `## Notes for other tasks` section has the
full reasoning.

**From task 02 — embed the symbol reference data:**

```xml
<ItemGroup>
  <EmbeddedResource Include="Reference\symbols.json" />
</ItemGroup>
```

`SymbolUniverse.Load` already asks for the manifest resource
`Tckr.MockExchange.Reference.symbols.json` first and falls back to the copy the Worker SDK
globs into the output directory as `Content`, so the build is green without this. Adding it
makes the universe independent of the output layout and survives single-file publish. If you
change `EnableDefaultContentItems` or the content globbing, this entry stops being optional —
add it before you touch that.

Also bind `UniverseSize` (default `SymbolUniverse.DefaultSize` = 250) and the run `Seed`
straight through to `SymbolUniverse.Load`.

**From task 01 — nothing.** Both `InternalsVisibleTo` entries already exist and no package
reference was needed. Do not remove them.

**From tasks 04, 05 — pending.** Both were asked to specify the options shapes they need
(`MarketSessionOptions`, `FeedServerOptions`) in their Notes sections. Read those before
writing `Options/`; the properties and defaults there are the contract their code was built
against.

### csproj and solution

- `InternalsVisibleTo` for `Tckr.MockExchange.Tests` and `Tckr.FeedProbe` is **already
  present** — leave it alone.
- `<ServerGarbageCollector>true</ServerGarbageCollector>` and
  `<ConcurrentGarbageCollection>true</ConcurrentGarbageCollection>` — this process is
  throughput-oriented; say why in a comment.
- `<InvariantGlobalization>false</InvariantGlobalization>` since we resolve a timezone.
- The test project and `tools/Tckr.FeedProbe` are **already registered** in `src/Tckr.slnx`.
  No solution-file changes should be needed.

---

## Tests

- Options validation: a bad ratio sum, an unknown phase name, overlapping phase windows,
  `MaxEventsPerSecond < BaseEventsPerSecond`, and an unresolvable timezone each fail at
  startup with a message naming the offending setting.
- Environment-variable override reaches the bound options object.
- Host starts and stops cleanly within 5 seconds (`IHost.StartAsync` / `StopAsync`).
- End-to-end smoke: start the host with `BaseEventsPerSecond = 1000`, connect a
  `TcpClient`, decode 1,000 frames, assert no sequence gaps, stop the host.
- The batch buffer is allocated once: assert steady-state allocation over a 5-second run
  is below a small bound (a few KB, not megabytes).

---

## Acceptance criteria

- [ ] `FeedPublisherService` implemented (the template `Worker.cs` is already deleted and
      `Program.cs` is a minimal placeholder host you should replace).
- [ ] All options bound, validated at startup, overridable by environment variable.
- [ ] Batch buffer allocated once; loop on a dedicated long-running thread.
- [ ] `dotnet run --project src/Tckr.MockExchange` starts, listens, and serves a consumer.
- [ ] Startup log line records seed, rate, mode, universe size, endpoint.
- [ ] Clean shutdown on Ctrl+C within the flush timeout.

## Verification

```bash
dotnet build src/Tckr.slnx
dotnet run --project src/Tckr.MockExchange
# in another shell
dotnet run --project tools/Tckr.FeedProbe -- --host localhost --port 9001 --duration 10
```

## Notes for other tasks
