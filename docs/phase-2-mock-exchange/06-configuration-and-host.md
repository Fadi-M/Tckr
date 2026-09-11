# Task 06 — Configuration, DI Wiring & Publisher Loop

| | |
|---|---|
| **Phase** | 2 — Mock Exchange |
| **Status** | Done |
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

**From tasks 04, 05 — delivered.** Both specified the options shapes they need
(`MarketSessionOptions`, `FeedServerOptions`) in their Notes sections. Read those before
writing `Options/`; the properties and defaults there are the contract their code was built
against. Task 05's note is explicit that the placeholder `Feed/FeedServerOptions.cs` moves to
`Options/`, changes namespace, and **is deleted from `Feed/`** — the type name, property names
and defaults must not change, because the tests are written against them.

**From task 03 — three things.**

1. **`Generation/GenerationOptions.cs` is a placeholder you own.** Same handover as
   `FeedServerOptions`: move it to `Options/`, change the namespace, delete the placeholder.
   Keep the property names and defaults; the generator's validation and tests are written
   against them.
2. **Set `FeedRecord.AuctionPrintFlag` yourself, over the batch you just generated.** The
   generator emits `Flags = 0` because whether a print came from an auction is `MarketPhase`'s
   knowledge (task 04), not the generator's, and you are the only component holding both the
   session clock and the record buffer. A whole-batch decision is correct here: a batch is 5 ms
   and a phase lasts minutes, so the worst error is one batch at a phase boundary. The rejected
   alternative was adding a `MarketPhase` parameter to `IMarketDataGenerator.Generate`, which
   would put phase knowledge in the wrong component to save nothing.
3. **Bind `DeterministicTimestamps` (default `false`) through to `GenerationOptions`.** See the
   note in task 09 below; leave the default alone.

**From task 07 — registration shape.** `FeedMetrics` implements `IFeedServerMetrics` directly,
so register the single instance under both service types rather than writing an adapter. Read
task 07's Notes for the exact constructor signature, the `ThroughputReporter` hosted-service
type, and `BindSessionCount` — the session-count gauge is a **late bind**, not a constructor
argument (the server takes the metrics, so the metrics cannot take the server), and until you
call it the gauge answers from the accept/close ledger instead of from the live roster.

One trap task 07 hit that you will too: under xUnit's async synchronization context,
`await hostedService.StartAsync(...)` does **not** guarantee `ExecuteAsync` has reached its
first `await`, so advancing a `FakeTimeProvider` immediately afterwards silently loses the
first tick. A `Task.Yield()` before advancing fixes it deterministically.

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

- [x] `FeedPublisherService` implemented; `Program.cs` replaced.
- [x] All options bound, validated at startup, overridable by environment variable.
- [x] Batch buffer allocated once; loop on a dedicated thread.
- [x] `dotnet run --project src/Tckr.MockExchange` starts, listens, and serves a consumer.
- [x] Startup log line records seed, rate, mode, universe size, endpoint.
- [x] Clean shutdown within the flush timeout, with a live consumer draining cleanly.

## Verification

```bash
dotnet build src/Tckr.slnx
dotnet run --project src/Tckr.MockExchange
# in another shell
dotnet run --project tools/Tckr.FeedProbe -- --host localhost --port 9001 --duration 10
```

## Notes for other tasks

Delivered files:

```text
src/Tckr.MockExchange/Program.cs                                    replaced the placeholder host
src/Tckr.MockExchange/FeedPublisherService.cs                       the generation loop
src/Tckr.MockExchange/MockExchangeServiceCollectionExtensions.cs    the whole composition
src/Tckr.MockExchange/Options/MockExchangeOptions.cs
src/Tckr.MockExchange/Options/MockExchangeOptionsValidator.cs
src/Tckr.MockExchange/Options/DiagnosticsOptions.cs
src/Tckr.MockExchange/Options/GenerationOptions.cs                  moved from Generation/
src/Tckr.MockExchange/Options/MarketSessionOptions.cs               moved from Session/
src/Tckr.MockExchange/Options/FeedServerOptions.cs                  moved from Feed/
src/Tckr.MockExchange/appsettings.json, appsettings.Development.json
src/Tckr.MockExchange/Tckr.MockExchange.csproj
tests/Unit/Tckr.MockExchange.Tests/Host/*.cs                        29 tests
```

Outside the ownership matrix, all of it pre-approved in the notes of the owning task: a
`using Tckr.MockExchange.Options;` added to `Feed/FeedServer.cs`, `Feed/FeedSession.cs`,
`Generation/RandomWalkGenerator.cs`, `Session/MarketSessionClock.cs` and the five test files that
name the moved types, plus one signature change in `Diagnostics/StartupSummary.cs` described below.
No behaviour in any of those files changed.

### One change in a file this task does not own

`StartupSummary.Log` took `int seed`. `GenerationOptions.Seed` is a `ulong`, and the default is
`0x5443_4B52_5345_4544`. Passing it through an `int` parameter truncates it — silently, and in the
one line whose entire purpose is to let someone reproduce a run six weeks later. The parameter is
now `ulong`. Nothing else changed: C#'s implicit constant conversion means task 07's existing test
call site (`seed: 20260304`) compiles and asserts unchanged.

### Two findings that were not in anyone's brief

**1. The configuration binder appends to a populated collection instead of replacing it.**
`MarketSessionOptions.Phases` defaults to the full six-phase schedule, which is the right default
for a type constructed in code and a trap for one bound from configuration: binding the six-phase
schedule in `appsettings.json` produced **twelve** windows, every one overlapping its own
duplicate. The validator caught it, so the symptom was a process that refused to start on its own
default configuration file — loud, and better than the alternative, but a bug either way. Fixed in
`AddMockExchange` with a `.Configure(...)` registered **before** `.Bind(...)` that empties the
default schedule when the configuration supplies one. `IConfigureOptions` runs in registration
order, and that ordering is the fix; a test pins it.

**2. The binder discards a collection item it cannot bind, without reporting it.** It binds each
item inside a `try` and moves on, so a phase entry naming a phase that does not exist, or a `Start`
that is not a time of day, simply is not there afterwards — and nothing on the bound object records
that it went missing. The exchange would run a schedule quietly short one window, most likely the
one being edited when the typo was made. `MockExchangeOptionsValidator` therefore holds the raw
`IConfiguration` and checks the configured phase entries against the bound ones. Two tests cover it.

### Deviations from this brief, and why

- **The configuration keys are the ones the components were built against, not the ones in this
  brief's example JSON.** Tasks 03, 04 and 05 each pinned their property names and defaults in
  their notes, with tests asserting them, and the brief's JSON disagrees in several places:
  `TradeRatio` vs. `TradeShare`, `DailyPriceBandPercent` vs. `DailyBandBasisPoints`,
  `ShutdownFlushTimeoutMs` vs. `ShutdownTimeoutMs`, `MarketSession` vs. `Session` as the section
  name. The completed code won. The full key list is propagated into task 09, which is the task
  that would otherwise write a sweep script against keys that bind to nothing.

- **The three message ratios are not required to sum to 1.0.** The brief asks for that rule and a
  test for it. Task 03 built the generator to *normalise* the mix, deliberately, so that `4/3/3`
  means the same thing as `0.4/0.3/0.3` — and enforcing the sum would make the integer form a
  start-up failure, contradicting behaviour that is already documented and tested. What the rule
  was protecting against is real, though: `0.4/0.3/0.2` is almost certainly a typo and silently
  becomes 44/33/22. So an empty mix fails at start-up, and a mix that does not sum to 1.0 logs a
  warning naming the three settings and the percentages it actually resolved to. Both are tested.

- **There is no root `Seed`, and no `0 = random`.** The seed lives at
  `MockExchange:Generation:Seed`. A second seed at the root would need a precedence rule between
  the two, and `0` is a legitimate seed with a test of its own in `Xoshiro256StarStarTests`, so
  overloading it to mean "pick one for me" would make the start-up line report a seed that is not
  the seed configured — in the one line that exists to make a run reproducible. A run that wants a
  fresh tape sets a fresh number.

- **`Options/FeedServerOptions.cs` carries no validation attributes.** Task 05's note asks for
  this: `FeedServer`'s constructor already validates every field it uses and has a test pinning
  that, so annotations here would be a second source of truth that can drift. It still fails at
  start-up rather than at first connection, because the publisher service takes the server and
  hosted services are constructed as the host starts — there is a test for that too.

- **`MockExchangeServiceCollectionExtensions` is a fourth file, not in the brief's layout.** The
  wiring is there rather than in `Program.cs` so the tests can start the real composition. A test
  that assembles its own service collection proves the components compose, which was never the
  question; the question is whether `Program.cs` does.

- **The loop runs on a real `Thread`, not `TaskCreationOptions.LongRunning`.** `LongRunning`
  dedicates a thread only until the first `await` and then hands continuations back to the pool,
  which is the trap the brief's requirement exists to avoid: the governor closes the last 2 ms to
  each deadline by spinning on whichever thread called it, so on a pool thread that is a worker
  taken out of circulation 200 times a second. The wait is blocking, deliberately — this thread
  exists to be occupied.

### For task 08 — the probe

`AuctionPrintFlag` **is** set now, on trades only, and only in `OpeningAuction` and
`ClosingAuction`. But `Session:Mode` defaults to `Continuous`, which is never an auction and is the
mode every benchmark runs in, so on a default run every record still has `Flags = 0`. Do not make a
passing run depend on seeing it. `MockExchange__Session__Mode=CompressedDay` cycles a whole trading
day every five minutes if you want to see it set. This is propagated into `08-feed-probe.md`.

The exchange listens on **9001** by default now, matching this brief's verification step and task
08's. `MockExchange__Feed__Port=0` binds an ephemeral port.

### For task 10 — ADR material

The two binder findings above are the honest candidates. Neither is a decision about the exchange;
both are decisions about how configuration is bound, and the second one — a validator that reads
the raw `IConfiguration` because the bound object cannot show what went missing — is the kind of
thing that reads as over-engineering until someone knows why.

Also worth recording: `ServerGarbageCollection` and `ConcurrentGarbageCollection` are on, and
`InvariantGlobalization` is off because the session resolves an IANA time zone. The reasons are in
comments in the csproj.

### Measured

```text
dotnet build src/Tckr.slnx                       Build succeeded, 0 errors
dotnet test  src/Tckr.slnx                       356 passed, 2 skipped, 0 failed
dotnet test --filter FullyQualifiedName~Host      29 passed
```

Release build, Apple silicon, `MockExchange__Session__BaseEventsPerSecond=25000`, one consumer
attached for 6 seconds mid-run:

```text
target=25000/s  achieved=25000/s (100.0%)  lag_p99=0.0ms  dropped=0  slow_disconnects=0
consumer received 6,600,036 bytes; session closed client-closed, dropped 0 records
generation continued at 25000/s with zero consumers attached
```

Shutdown, SIGTERM with a live consumer attached:

```text
Feed server stopping; draining 1 sessions within 2000 ms.
Feed session ... closed: server-shutdown. Sent 4400036 bytes, dropped 0 records.
consumer saw a clean EOF after exactly 4,400,036 bytes
```

Steady-state allocation over a 2-second window at 25,000 events/sec is under 1 MB, asserted by
`ASteadyStateRunDoesNotAllocatePerEvent`. The bound is loose on purpose: reallocating the
2,500-record batch buffer per batch would be roughly 40 MB over the same window, so the test
distinguishes the failure it is looking for without being a flaky assertion about the handful of
per-batch allocations the timer and the wait genuinely do make.
