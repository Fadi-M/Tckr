# Task 01 — Feed Wire Protocol & Frame Codec

| | |
|---|---|
| **Phase** | 2 — Mock Exchange |
| **Status** | Done — layout frozen |
| **Depends on** | — |
| **Blocks** | 03, 05, 07, 08, 10 |
| **Parallel with** | 02, 04 |
| **Owns** | `src/Tckr.MockExchange/Protocol/**`, `tests/Unit/Tckr.MockExchange.Tests/Protocol/**` |

> **Scaffolding is already done.** The test project (`tests/Unit/Tckr.MockExchange.Tests`,
> xUnit + Shouldly + `FakeTimeProvider` + `MetricCollector`), the probe project
> (`tools/Tckr.FeedProbe`), both `InternalsVisibleTo` entries, the empty area folders under
> `src/Tckr.MockExchange/`, and the `src/Tckr.slnx` registrations all exist and build.
> Add your files into the existing structure; do not re-create projects or touch the
> solution file.

---

## Objective

Define and implement the exchange-side wire protocol: the frame layout, the message
types, and a zero-allocation encoder/decoder pair.

This is the contract every other Phase 2 task and all of Phase 3 depends on. Get it
right and freeze it; downstream tasks will be written against the layout below.

---

## Why this shape

The protocol is deliberately **binary, fixed-layout and exchange-specific**. It is not
our internal event model. Phase 3 must do real parsing and normalization work to turn
this into `MarketDataEvent`, which is the whole point of having an ingestion boundary.

Fixed-point prices are non-negotiable: `double` cannot represent `85.10` exactly, and a
market-data system that rounds is a market-data system that is wrong.

---

## Specification

### Framing

Every message on the wire is length-prefixed:

```text
┌──────────────────┬────────────────────────────┐
│ uint32 LE length │ payload (length bytes)     │
└──────────────────┴────────────────────────────┘
```

- `length` counts payload bytes only; it does not include the 4-byte prefix.
- Maximum accepted payload: `1024` bytes. Anything larger is a protocol error.
- All multi-byte integers are **little-endian**, written via `BinaryPrimitives` so the
  encoding is correct regardless of host endianness.

### Message types

```csharp
internal enum FeedMessageType : byte
{
    Trade        = 1,
    BidQuote     = 2,
    AskQuote     = 3,
    Heartbeat    = 10,
    SessionStart = 11,
}
```

### Tick payload — `Trade` / `BidQuote` / `AskQuote` (40 bytes)

```text
Offset  Size  Type      Field
──────────────────────────────────────────────────────────────────────
  0      1    byte      Version                (= 1)
  1      1    byte      MessageType            (1 | 2 | 3)
  2      2    ushort    Flags                  (bit 0 = auction print, rest reserved = 0)
  4      4    uint      Quantity               (shares; > 0)
  8      8    ulong     SequenceNumber         (monotonic per session, starts at 1)
 16      8    long      ExchangeTimestampNanos (Unix epoch nanoseconds, UTC)
 24      8    long      PriceScaled            (price × 10_000)
 32      8    byte[8]   Symbol                 (ASCII, right-padded with 0x20)
──────────────────────────────────────────────────────────────────────
Total payload: 40 bytes.  On the wire: 44 bytes.
```

44 bytes × 25,000/sec ≈ **1.1 MB/sec**. Note in the ADR that this is much smaller than
the ~200 bytes/event the master context estimates for the *normalized* event — the
inflation happens at normalization, not on the exchange wire.

### `SessionStart` payload (32 bytes)

Sent as the very first frame on every accepted connection.

```text
Offset  Size  Type      Field
──────────────────────────────────────────────────────────────────────
  0      1    byte      Version                (= 1)
  1      1    byte      MessageType            (= 11)
  2      2    ushort    Flags                  (reserved = 0)
  4      4    uint      HeartbeatIntervalMs
  8     16    byte[16]  SessionId              (GUID, RFC 4122 byte order)
 24      8    long      StartTimestampNanos
──────────────────────────────────────────────────────────────────────
```

### `Heartbeat` payload (24 bytes)

Emitted every `HeartbeatIntervalMs` (default 1000) whenever no tick has been sent in
that window. Lets a consumer distinguish "quiet market" from "dead socket".

```text
Offset  Size  Type      Field
──────────────────────────────────────────────────────────────────────
  0      1    byte      Version                (= 1)
  1      1    byte      MessageType            (= 10)
  2      2    ushort    Flags                  (reserved = 0)
  4      4    uint      Reserved               (= 0)
  8      8    ulong     LastSequenceNumber     (last tick seq, 0 if none)
 16      8    long      TimestampNanos
──────────────────────────────────────────────────────────────────────
```

### Sequence number semantics

- Per **session**, not global. Each accepted connection starts at 1.
- Incremented for tick messages only. Heartbeats and `SessionStart` do not consume one.
- A gap observed by a consumer means data loss and must be treated as an error.
- Phase 3 will derive its `eventId` from `(SessionId, SequenceNumber)`. Say so in the
  XML docs on `FeedRecord.SequenceNumber` so the coupling is discoverable.

### Symbol encoding

- ASCII uppercase, 1–8 characters, right-padded with spaces (`0x20`).
- The decoder trims trailing spaces; embedded spaces are a protocol error.

---

## Deliverables

Create under `src/Tckr.MockExchange/Protocol/`:

**`PriceScale.cs`**
```csharp
internal static class PriceScale
{
    internal const int Decimals = 4;
    internal const long Factor = 10_000;

    internal static long ToScaled(decimal price);
    internal static decimal FromScaled(long scaled);
}
```
`ToScaled` must round half-away-from-zero and throw on overflow. Include the constants
rather than magic numbers everywhere.

**`FeedMessageType.cs`** — the enum above.

**`FeedRecord.cs`** — a `readonly record struct` carrying the tick fields. Symbol is
stored as a fixed 8-byte inline buffer or an 8-char value type, **not** a `string`;
the generation loop must not allocate. Provide `SymbolAsString()` for tests and logs
only, clearly documented as non-hot-path.

**`FeedFrameWriter.cs`** — static encoder:
```csharp
internal static class FeedFrameWriter
{
    internal const int TickFrameSize = 44;
    internal const int HeartbeatFrameSize = 28;
    internal const int SessionStartFrameSize = 36;

    internal static int WriteTick(Span<byte> destination, in FeedRecord record);
    internal static int WriteHeartbeat(Span<byte> destination, ulong lastSeq, long timestampNanos);
    internal static int WriteSessionStart(Span<byte> destination, Guid sessionId, uint heartbeatMs, long startNanos);
}
```
Each returns bytes written. Each throws `ArgumentException` if the destination is too
small. No allocations, no `MemoryStream`, no `BinaryWriter`.

**`FeedFrameReader.cs`** — the decoding half, used by tests, the probe (task 08) and as
the reference implementation Phase 3 will port:
```csharp
internal static class FeedFrameReader
{
    internal static bool TryReadFrame(ref ReadOnlySequence<byte> buffer, out FeedMessageType type, out ReadOnlySequence<byte> payload);
    internal static FeedRecord ReadTick(ReadOnlySpan<byte> payload);
}
```
`TryReadFrame` must handle partial frames correctly — it is consumed from a
`System.IO.Pipelines` reader where a frame can straddle segment boundaries. Returning
`false` means "need more data", and the caller's buffer position must be unchanged.

> `InternalsVisibleTo("Tckr.MockExchange.Tests")` and `InternalsVisibleTo("Tckr.FeedProbe")`
> are already present in `Tckr.MockExchange.csproj`. Keep these types `internal`; both the
> tests and the probe can see them.

---

## Tests

`tests/Unit/Tckr.MockExchange.Tests/Protocol/`

- Round-trip: encode a `FeedRecord`, decode it, all fields identical.
- Exact byte layout: encode a known record, assert the resulting 44 bytes against a
  hard-coded expected array. This is the regression guard that stops someone silently
  reordering fields.
- Length prefix equals payload size for each message type.
- `TryReadFrame` with a buffer split at every byte offset 1..43 returns `false` until
  the frame is complete, then succeeds — parameterised over the split point.
- `TryReadFrame` returns two frames from a buffer holding 2.5 frames, leaving the
  partial third untouched.
- Symbol padding and trimming, including a 1-char and an 8-char symbol.
- `PriceScale` round-trips `85.10`, `0.0001`, `999_999.9999`; rejects more than 4 dp
  by rounding, and throws on overflow.
- Oversized declared length (> 1024) is rejected as a protocol error.
- Allocation guard: encoding 10,000 records into a stack/pooled buffer allocates zero
  bytes (`GC.GetAllocatedBytesForCurrentThread()` before/after).

---

## Acceptance criteria

- [ ] All types above exist with the exact layout specified.
- [ ] Encode path allocates zero bytes per record, verified by test.
- [ ] Byte-layout regression test present with hard-coded expected bytes.
- [ ] Partial-frame handling proven for every split offset.
- [ ] `dotnet build src/Tckr.slnx` and `dotnet test` pass.
- [ ] XML doc comments on every public/internal type explaining the *why*, not the *what*.

## Verification

```bash
dotnet build src/Tckr.slnx
dotnet test tests/Unit/Tckr.MockExchange.Tests --filter FullyQualifiedName~Protocol
```

## Notes for other tasks

Nothing is needed from another task's files. Task 06 does not need to touch
`Tckr.MockExchange.csproj` on behalf of this task: the two `InternalsVisibleTo` entries were
already there, and no package reference was added.

Points the downstream tasks should know:

- **`Symbol8` is the symbol type**, declared in `FeedRecord.cs`. It packs the eight wire bytes
  into a `ulong`, so it is allocation-free to carry, and comparison/hashing are one integer
  operation — cheap enough to use directly as the dictionary key for per-symbol state (task 03).
  Build one with `Symbol8.FromAscii("COMI")`; `ToString()` allocates and is for logs and tests
  only. Task 02's `SymbolDefinition.Symbol` can stay a `string`; convert once at load time.
- **`FeedRecord` has no `Version` field.** Only version 1 exists and the reader rejects anything
  else before a record is constructed, so there is nothing to branch on downstream.
- **`FeedRecord.MessageType` must be a tick type.** `WriteTick` throws `ArgumentException` on
  `Heartbeat`/`SessionStart`; those are written by their own methods (task 05).
- **The symbol codec accepts any printable non-space ASCII**, not just `A`–`Z`, so tickers such
  as `BRK.B` encode. Uppercase-and-listing rules belong to the symbol universe (task 02), not to
  the framing layer.
- **Every protocol violation throws `InvalidDataException`;** `TryReadFrame` returning `false`
  means "need more data" and nothing else. Task 05 and task 08 should treat the exception as
  "drop the connection and resynchronise" — a framing error means the reader no longer knows
  where the next frame starts.
- **`FeedFrameReader` gained three members beyond the brief**, all zero-allocation, because task
  08's probe needs them and does not own `Protocol/`: `ReadTick(in ReadOnlySequence<byte>)`
  (stack-copies when a payload straddles segments), `ReadHeartbeat(...)` and
  `ReadSessionStart(...)`, both `out`-parameter based so no new types appear on the wire
  contract.
- **Task 10 (ADR-001):** 44 bytes on the wire × 25,000/sec ≈ 1.1 MB/sec, against the master
  context's ~200 bytes for a *normalized* event — the inflation happens at normalization, not on
  the exchange wire. Also worth recording: session ids are written in RFC 4122 (big-endian) byte
  order rather than .NET's native mixed-endian layout, because consumers will not all be .NET.
- **`ScaffoldTests.cs` has been deleted**, as the README instructed the first real suite to do.

### Verified

```text
dotnet build src/Tckr.slnx                                             Build succeeded
dotnet test  tests/Unit/Tckr.MockExchange.Tests --filter ...Protocol   132 passed, 0 failed
```
