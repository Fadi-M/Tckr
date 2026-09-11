# ADR 001 — Binary length-prefixed wire protocol

- **Status:** Accepted
- **Date:** 2026-09-10
- **Phase:** 2 — Mock Exchange
- **Deciders:** Phase 2 task agents (wire format: task 01; encode strategy: task 05), coordinator Fadi Matta

## Context

`Tckr.MockExchange` has to be exchange-*like*, not a convenience format. If the wire
format is something Phase 3's ingestion service can parse with `JsonSerializer.Deserialize`,
Phase 3 has no real parsing or normalization work to do, and every measurement taken
downstream of it is measuring something easier than the real problem. The master
context's whole premise is a single 25,000-events/sec exchange connection carrying
market data in a format the rest of the system does not natively speak — the format
has to earn that premise.

Prices are the one place there is no room for a design conversation: `double` cannot
represent `85.10` exactly, so any wire format that carries price as a binary float
disagrees with the venue's own printed tape at the last decimal, intermittently, under
load. This is settled by the master context's conventions and repeated here because it
constrains every alternative below.

## Decision

A binary, length-prefixed, fixed-layout protocol, little-endian throughout, with prices
as `long` fixed-point (4 implied decimals, factor 10,000 — see
[`wire-protocol.md`](../phase-2-mock-exchange/wire-protocol.md) for the byte-level
layout, the worked example, and sequence-number semantics). Every message is
`uint32 LE length` followed by that many payload bytes; three message types exist today
— tick (`Trade`/`BidQuote`/`AskQuote`, 44 bytes on the wire), `Heartbeat` (28 bytes) and
`SessionStart` (36 bytes) — discriminated by a byte inside the payload, not by the
frame itself.

### Encoding strategy: per-session encode, not encode-once-and-patch

A second decision belongs here because it is about the same artifact — how a batch
becomes bytes on N session sockets — even though it was made two tasks later, once the
server existed to measure against. Two allocation-free candidates:

- **A — per-session encode.** Each session encodes the batch directly into its own
  `PipeWriter` memory via `FeedFrameWriter`. Full encode per session, zero copies, no
  scratch buffer.
- **B — encode once, fan out and patch.** Encode the batch once into a shared scratch
  buffer, then per session copy it into the pipe and overwrite the 8-byte sequence
  field at a hard-coded offset in each 44-byte frame.

Measured on the development machine (Apple silicon, .NET 10, Release, 125-record
batches — the 5 ms batch at the 25,000/sec target — 200,000 iterations, best of three):

| Sessions | A: per-session encode | B: encode-once + patch | Winner |
|---|---|---|---|
| 1 | 1.12 ns/rec/session (140 ns/batch) | 1.81 ns/rec/session (226 ns/batch) | A |
| 2 | 1.15 ns/rec/session (289 ns/batch) | 1.28 ns/rec/session (319 ns/batch) | A |
| 4 | 1.12 ns/rec/session (558 ns/batch) | 1.01 ns/rec/session (504 ns/batch) | B |
| 8 | 1.12 ns/rec/session (1119 ns/batch) | 0.88 ns/rec/session (875 ns/batch) | B |
| 16 | 1.09 ns/rec/session (2184 ns/batch) | 0.84 ns/rec/session (1678 ns/batch) | B |

**Chosen: A**, even though B wins from 4 sessions onward. At the default `MaxSessions`
of 8 — already twice the realistic number of consumers this phase has (one ingestion
service, one probe) — B saves 244 ns per 5 ms batch: 0.005% of the batch budget, about
48 microseconds of CPU per second at 25,000 records/sec. The tie-break is not
throughput; it is invariants. A encodes through `FeedFrameWriter` and nothing else and
lands bytes in their final destination in one step. B adds two things that can silently
rot: a hard-coded byte offset for the sequence field that no test forces to agree with
`FeedFrameWriter`'s own layout — `FeedFrameWriter` could pass every one of its own tests
while the fan-out patches sequence numbers into what used to be the timestamp — and a
scratch buffer whose lifetime has to be reasoned about across sessions that read it at
different times. Paying 0.005% of a batch to keep the wire layout knowable in exactly
one place is the right trade.

## Alternatives Considered

- **JSON lines.** Human-readable, trivial to debug with `nc` or a browser. Rejected:
  roughly 4x the bytes of the binary layout, and allocation-heavy to parse at 25,000/sec
  — a `JsonDocument` per tick is exactly the GC pressure the rate governor and generator
  spend their whole design avoiding one allocation at a time. It also gives Phase 3
  nothing to normalize; a JSON tick is already shaped like an internal event.
- **Protobuf / Avro.** Real schema evolution story, code-generated types, wide language
  support. Rejected for Phase 2: it is a dependency and a build step for a component
  whose entire job is to be adversarial like an exchange, and no real exchange speaks
  Protobuf on its market-data line — choosing it would trade "exchange-like" for
  "convenient," which is the one trade this component is not supposed to make.
- **A real standard (ITCH, OUCH, FIX).** Maximum realism — a decoder for this would be a
  decoder for something that exists outside this repository. Rejected because the
  interview problem this phase supports is fan-out and throughput, not protocol
  implementation; building a spec-accurate ITCH encoder is disproportionate effort for
  a problem that only needs *a* binary framing, not *that* one. Revisit if realism
  against a named venue protocol ever becomes an explicit goal (see Revisit If).
- **Fixed-layout binary (chosen).** Cheap to encode and decode, small on the wire,
  genuinely unlike the internal event model, and simple enough that a byte-level
  regression test can pin the entire layout in one file.

## Consequences

- **Cheap to encode and decode.** `FeedFrameWriter`/`FeedFrameReader` do no allocation
  on the hot path (asserted by test), and the whole tick payload fits in a single cache
  line comfortably.
- **Brittle against change.** A fixed byte layout has no self-describing schema; adding
  a field means a new message type or a version bump, not an additive JSON key.
  Mitigated by `Protocol/`'s byte-level regression test (`01-wire-protocol.md`), which
  fails the build the moment a field's offset moves, and by the version byte on every
  payload — version 1 is the only one that exists today, and the reader rejects
  anything else before a record is even constructed, so there is nothing to silently
  misinterpret.
- **Needs tooling to read on the wire.** There is no browser or `curl` for this format.
  `Tckr.FeedProbe` (task 08) exists specifically to be that tool, both for benchmarking
  and as a day-to-day smoke-test client.
- **Real inflation happens downstream, not here.** The wire record is 44 bytes; the
  master context estimates roughly 200 bytes for a *normalized* internal event. That
  ~4.5x growth happens entirely at Phase 3's parse/normalize step — symbol expands from
  8 packed bytes to a lookup key plus metadata, the record gains an internal event id,
  routing fields, and whatever envelope Kafka serialization adds. Worth stating
  explicitly because it changes the capacity arithmetic between the exchange link
  (≈1.1 MB/sec at 44 bytes × 25,000/sec) and Kafka (≈4.5x that once normalized) — a
  capacity plan that sizes Kafka off the wire byte count would be wrong by that factor.
- **Session identifiers are RFC 4122 (big-endian) byte order on the wire**, not .NET's
  native mixed-endian `Guid` layout, because Phase 3 and any other consumer will not all
  be .NET processes reading a `Guid` the way .NET does. This is a small decision buried
  in `FeedFrameWriter.WriteSessionStart`, recorded here because it is exactly the kind
  of interoperability detail that is invisible until a second-language client tries to
  parse a session id and gets sixteen bytes in the wrong order.

## Revisit If

- Phase 3 (or any consumer) needs the wire format to evolve while old and new versions
  are both in flight — the version byte supports rejection, not negotiation, and adding
  real schema evolution would mean redesigning around that.
- A named real-world protocol (ITCH, FIX) becomes a literal requirement rather than a
  "shaped like an exchange" one — the fixed-layout binary was chosen because that
  realism was explicitly out of scope; if it comes into scope, this decision should be
  re-opened rather than patched.
- The session roster genuinely grows past a handful of consumers (the measurement above
  says B overtakes A between 2 and 4 sessions) — re-run the benchmark on the report
  hardware and switch to encode-once-and-patch with a test that pins the patched offset
  against `FeedFrameWriter`'s own output, closing the gap this ADR accepted.
