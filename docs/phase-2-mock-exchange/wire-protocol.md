# Tckr Mock Exchange — Wire Protocol Reference

> Standalone reference for the binary feed `Tckr.MockExchange` speaks on its TCP port.
> Complete enough to write a decoder against without opening the C# source. The
> reference implementation lives at `src/Tckr.MockExchange/Protocol/` — `FeedFrameWriter.cs`
> (encoder), `FeedFrameReader.cs` (decoder), `FeedRecord.cs` (the tick type and the
> `Symbol8` packed-symbol type), `FeedMessageType.cs`, `PriceScale.cs`. Phase 3's
> ingestion parser is expected to port `FeedFrameReader.cs`, not reimplement it from
> this document alone — but this document should be enough to check that port against,
> or to write a decoder in a different language entirely.
>
> Design rationale lives in [ADR 001](../decisions/001-mock-exchange-wire-protocol.md) — this
> file is the *what*, that one is the *why*.

---

## 1. Transport

One TCP connection per consumer. The exchange never blocks generation on a slow
consumer — see [ADR 002](../decisions/002-slow-consumer-policy.md) for what happens to a
consumer that falls behind. The connection is one-directional in practice: the server
reads from the socket only to detect that the peer closed it, and discards anything the
client sends.

The **first frame on every accepted connection is `SessionStart`**, always, before any
tick or heartbeat. A client that does not receive it before the connection closes was
never a valid session (commonly: the server was already at `MaxSessions` and refused
the connection immediately after accept).

## 2. Framing

Every message on the wire — regardless of type — is a 4-byte length prefix followed by
that many payload bytes:

```text
┌────────────────────┬──────────────────────────────┐
│ uint32 LE  length   │  payload (length bytes)      │
└────────────────────┴──────────────────────────────┘
```

- `length` is the payload size **only**; it does not include itself.
- All multi-byte integers on the wire, in the length prefix and in every payload, are
  **little-endian**.
- Maximum accepted payload is **1024 bytes**. A declared length outside `[2, 1024]` is a
  protocol error (see §10).
- A frame's payload always begins with the same two bytes: `Version` (byte 0) and
  `MessageType` (byte 1). A decoder can always classify a frame from its first two
  payload bytes before parsing anything else.
- There is no `Version` field on the decoded record type — only wire version `1` exists.
  A decoder should reject anything else outright rather than carry a branch for a
  version that has never shipped.

## 3. Message types

```text
Trade        = 1
BidQuote     = 2
AskQuote     = 3
Heartbeat    = 10
SessionStart = 11
```

`Trade`, `BidQuote` and `AskQuote` share one payload layout ("tick", §4) and are
distinguished only by this byte. The numeric gap between the tick types (1–3) and the
session types (10–11) is deliberate headroom for future tick kinds without renumbering
anything a consumer already understands.

## 4. Tick payload — `Trade` / `BidQuote` / `AskQuote`

40 bytes of payload, 44 bytes on the wire including the length prefix.

```text
Offset  Size  Type      Field                    Notes
──────────────────────────────────────────────────────────────────────────────────
  0      1    byte      Version                  = 1
  1      1    byte      MessageType              1 (Trade) | 2 (BidQuote) | 3 (AskQuote)
  2      2    ushort    Flags                    bit 0 = auction print; rest reserved 0
  4      4    uint      Quantity                 shares; always > 0
  8      8    ulong     SequenceNumber           see §6 — read this before decoding a gap
 16      8    long      ExchangeTimestampNanos   Unix epoch nanoseconds, UTC
 24      8    long      PriceScaled              price × 10,000, see §5
 32      8    byte[8]   Symbol                   ASCII, right-padded with 0x20 (space)
──────────────────────────────────────────────────────────────────────────────────
Total payload: 40 bytes.  Total on the wire (with the 4-byte length prefix): 44 bytes.
```

`Flags` bit 0 (`0x0001`, `AuctionPrintFlag`) marks a trade print that occurred during an
opening or closing auction rather than continuous trading. It is only ever set under
the `OpeningAuction`/`ClosingAuction` market-session phases — the default `Continuous`
session mode never sets it, so a decoder should not assume it appears on every run. All
other bits are reserved and must be `0` in this version.

At 25,000 ticks/sec, 44 bytes/tick is ≈1.1 MB/sec of wire traffic — see ADR 001 for why
this is roughly 4.5x smaller than the master context's ~200-byte estimate for a
*normalized* internal event (the inflation happens at Phase 3's parse/normalize step,
not on this wire).

## 5. Fixed-point prices

Prices never travel as floating point. `PriceScaled` is a `long` holding the price
multiplied by **10,000** (4 implied decimal places): `85.10` on the wire is the integer
`851000`. To recover the decimal price, divide by `10,000`. Rounding, when a price is
scaled for the wire, is half-away-from-zero (not the more common banker's rounding) —
this matches how exchanges round, so a reconciliation against a venue's own printed tape
does not disagree at the last decimal.

## 6. Sequence number semantics — read this before writing a gap check

`SequenceNumber` is the field in this protocol most likely to be decoded wrong, because
its contract is easy to guess incorrectly. Get this section right before trusting any
gap-detection logic against it.

- **Sequence numbers are per session, not global.** Each accepted connection gets a
  fresh session id (in the `SessionStart` frame, §7) and its own counter starting at 1.
  A reconnect is a new session: do not carry a sequence counter across a reconnect, and
  do not treat a restart at 1 with a new session id as a gap.
- **Only tick messages consume a sequence number.** `Heartbeat` and `SessionStart` do
  not increment or consume one. A gap check that counts every frame rather than only
  ticks will find phantom gaps around every heartbeat.
- **The counter counts records the session was *offered*, not records it was sent.**
  This is the detail most decoders get wrong, because "sequence number" ordinarily
  means "position among what I received." Here it means *position in the exchange's
  tape since this session connected*. Every tick generated while this session is
  registered consumes a number on that session's counter — including a tick the session
  could not be sent because it was behind (see ADR 002) and including a tick discarded
  from an already-queued buffer under the `DropOldest` slow-consumer policy. A withheld
  or discarded record still burns its number.
- **The consequence: a gap in the numbers you actually receive is exactly the size of
  what the exchange withheld from you**, not an estimate. `highest_seen_sequence −
  records_actually_received` at any point in the stream is the precise loss count. This
  is deliberate and is the entire point of numbering this way — see
  [ADR 002](../decisions/002-slow-consumer-policy.md) for the story of why the numbering
  used to work differently (by write, not by offer) and why that was a bug, not a
  design choice.
- **A gap on this transport is always exchange-side loss, never network loss.** TCP
  delivers bytes reliably and in order or it breaks the connection; this protocol's own
  reader treats any framing inconsistency as fatal (§10) rather than resynchronising
  past it. So a gap inside a successfully decoded stream cannot be attributed to the
  network — the network's failure mode here is a broken connection, not a silent hole.
- **A gap is never reordering or duplication.** Neither can happen on a single TCP
  session. A sequence number lower than one already seen, or a repeat of one already
  seen, is a decoder or exchange bug — report it as a distinct condition from a gap, not
  folded into the same counter.
- **Under the default `Disconnect` policy, a well-behaved consumer should never observe
  a gap at all** — a session that would have to withhold a record is disconnected
  instead (reason `slow-consumer-loss`), so gap-free is the expected steady state.
  Under `DropOldest`, a gap is the documented, expected disclosure of exactly how much
  was dropped, and the session continues. The numbering contract is identical under
  both policies; only the surrounding behaviour differs. Write the gap check once.
- **One blind spot, so a decoder does not claim more precision than the wire actually
  gives it.** Records withheld *after* the last record the session actually received
  are invisible until the next record arrives on that session, because nothing on the
  wire names a sequence number that was never sent. Under `Disconnect` this cannot
  persist, because the session closes. Under `DropOldest` the very next tick reveals
  the gap. It only survives undetected if the feed goes permanently silent immediately
  after a drop on that session — a case this protocol does not currently give a
  decoder any way to detect (see `Heartbeat`, next bullet, for the closest available
  signal and its limit).
- **`Heartbeat.LastSequenceNumber` is a complementary, positive checkpoint, not a
  substitute for the counter above.** It carries the highest sequence number the
  session has actually had *written* to it (0 before the first tick) — the opposite
  quantity from the tick counter, which counts what was *offered*. While the socket is
  open, `LastSequenceNumber` greater than the highest tick sequence you have received
  means data is in flight or your own reader is behind, not that data was lost — it is
  a "everything up to N has left the exchange process" checkpoint. A hole *below*
  `LastSequenceNumber` is loss you can already see directly from the tick stream
  itself.
- **Phase 3 derives its internal event id from the pair `(SessionId, SequenceNumber)`.**
  This is why the counter is scoped per session rather than global: reusing session-less
  global numbering would make that identity collide across reconnects.

## 7. `SessionStart` payload

Sent as the very first frame on every accepted connection, before any tick or
heartbeat.

32 bytes of payload, 36 bytes on the wire.

```text
Offset  Size  Type      Field                  Notes
──────────────────────────────────────────────────────────────────────────
  0      1    byte      Version                = 1
  1      1    byte      MessageType            = 11
  2      2    ushort    Flags                  reserved = 0
  4      4    uint      HeartbeatIntervalMs     the server's configured heartbeat interval
  8     16    byte[16]  SessionId               GUID, RFC 4122 byte order (big-endian)
 24      8    long      StartTimestampNanos     Unix epoch nanoseconds, UTC
──────────────────────────────────────────────────────────────────────────
Total payload: 32 bytes.  Total on the wire: 36 bytes.
```

`SessionId` is written **RFC 4122 (big-endian, network) byte order**, deliberately not
.NET's native mixed-endian `Guid` layout — consumers of this feed will not all be .NET
processes, and RFC 4122 order is what every non-.NET GUID/UUID parser expects. A .NET
decoder must read it with `new Guid(bytes, bigEndian: true)`
(`FeedFrameReader.ReadSessionStart` does exactly this); reading it with the default
`Guid(byte[])` constructor will silently produce the wrong identifier.

Use `HeartbeatIntervalMs` from this frame to size a staleness timeout on the read side —
`interval × 1.5` is what this repository's own probe and tests use, and it holds in
practice: it tolerates ordinary scheduling jitter around a heartbeat without waiting
long enough to mask a genuinely dead connection.

## 8. `Heartbeat` payload

Emitted on a session whenever `HeartbeatIntervalMs` has elapsed with no tick sent on
that session — i.e. only while the session is otherwise idle. A session under
sustained tick traffic may legitimately never see one for the whole run; do not treat
their absence under load as a fault.

24 bytes of payload, 28 bytes on the wire.

```text
Offset  Size  Type      Field                  Notes
──────────────────────────────────────────────────────────────────────────
  0      1    byte      Version                = 1
  1      1    byte      MessageType            = 10
  2      2    ushort    Flags                  reserved = 0
  4      4    uint      Reserved               = 0
  8      8    ulong     LastSequenceNumber     last tick sequence *written* to this
                                                 session; 0 if none yet — see §6
 16      8    long      TimestampNanos         Unix epoch nanoseconds, UTC
──────────────────────────────────────────────────────────────────────────
Total payload: 24 bytes.  Total on the wire: 28 bytes.
```

## 9. Symbol encoding

- Exactly 8 bytes on the wire, ASCII, right-padded with `0x20` (space) to fill unused
  trailing bytes.
- The wire codec itself accepts any printable, non-space ASCII byte (`0x21`–`0x7E`) in
  the used portion — not only `A`–`Z` — so tickers containing digits or punctuation
  (e.g. `BRK.B`) encode without special-casing. Uppercase-only and listing rules are a
  property of *this exchange's own symbol universe* (`symbols.json`, pattern
  `^[A-Z0-9]{1,8}$`), not of the framing layer — a different mock exchange instance
  built on the same wire protocol could legally list something the framing layer alone
  would not reject.
- A decoder must reject a symbol field that is entirely padding (empty symbol) and one
  that has a *printable* byte **after** a padding byte (an embedded space) — both are
  protocol errors, not values to trim-and-accept, because trimming would silently
  choose one of two different readings of an ambiguous field.
- Symbols shorter than 8 characters are padded on the right only; there is no left
  padding and no other fill byte.

## 10. Protocol errors

Every violation of the rules above — an out-of-range length prefix, an unsupported
version byte, an unrecognized message type, a declared length that disagrees with that
type's fixed payload size, a malformed symbol field — is fatal to the connection. This
reference implementation raises `InvalidDataException` and expects the caller to close
the connection and resynchronise by reconnecting, not by attempting to skip past the bad
frame: once a frame fails to parse, a reader no longer reliably knows where the next
frame begins, so any attempt to keep reading risks silently reinterpreting arbitrary
bytes as a new frame. This is distinct from "not enough bytes yet" (`TryReadFrame`
returning `false`), which is the ordinary, expected state while more of a frame is
still in flight over the socket and requires no special handling beyond reading more
bytes.

## 11. Worked example — one encoded `COMI` trade

A `Trade` tick for `COMI`, 100 shares at `85.10`, sequence number `42`, timestamp
2024-01-01T00:00:00Z, no flags set. This is exactly the byte sequence
`FeedFrameWriter.WriteTick` produces for that record — verified against the encoder's
own field order and endianness, not hand-derived.

**Full 44-byte frame, as it appears on the wire:**

```text
28 00 00 00 01 01 00 00 64 00 00 00 2A 00 00 00
00 00 00 00 00 00 65 01 17 10 A6 17 38 FC 0C 00
00 00 00 00 43 4F 4D 49 20 20 20 20
```

**Field by field** (payload offsets are relative to byte 4, i.e. after the length
prefix; frame offsets are absolute):

| Frame offset | Payload offset | Size | Field | Bytes (hex) | Decoded |
|---|---|---|---|---|---|
| 0–3 | — | 4 | Length prefix | `28 00 00 00` | `0x00000028` = 40 (payload bytes) |
| 4 | 0 | 1 | Version | `01` | 1 |
| 5 | 1 | 1 | MessageType | `01` | `Trade` |
| 6–7 | 2 | 2 | Flags | `00 00` | `0x0000` — no bits set |
| 8–11 | 4 | 4 | Quantity | `64 00 00 00` | `0x00000064` = 100 shares |
| 12–19 | 8 | 8 | SequenceNumber | `2A 00 00 00 00 00 00 00` | `0x2A` = 42 |
| 20–27 | 16 | 8 | ExchangeTimestampNanos | `00 00 65 01 17 10 A6 17` | `0x17A610170165 0000` = 1,704,067,200,000,000,000 → 2024-01-01T00:00:00.000000000Z |
| 28–35 | 24 | 8 | PriceScaled | `38 FC 0C 00 00 00 00 00` | `0x000000000CFC38` = 851,000 → `851000 / 10,000` = `85.10` |
| 36–43 | 32 | 8 | Symbol | `43 4F 4D 49 20 20 20 20` | `"COMI"` + 4 trailing `0x20` (space) pad bytes |

Reading the multi-byte fields: every one of them is little-endian, so the *first* byte
of `SequenceNumber` (`0x2A`) is the low-order byte of the value, not the high-order one
— `2A 00 00 00 00 00 00 00` is `42`, not a very large number starting with `0x2A`. This
trips up decoders written against a big-endian mental model more often than any other
part of this format.

A decoder that reads this frame correctly should reconstruct:

```text
Version = 1, MessageType = Trade, Flags = 0x0000 (no auction-print bit),
Quantity = 100, SequenceNumber = 42,
ExchangeTimestampNanos = 1704067200000000000  (2024-01-01T00:00:00Z),
Price = 85.10, Symbol = "COMI"
```

---

## Appendix — quick reference

| Message | `MessageType` | Payload bytes | Wire bytes (incl. 4-byte prefix) |
|---|---|---|---|
| `Trade` / `BidQuote` / `AskQuote` | 1 / 2 / 3 | 40 | 44 |
| `Heartbeat` | 10 | 24 | 28 |
| `SessionStart` | 11 | 32 | 36 |

Related reading: [`docs/phase-2-mock-exchange/README.md`](README.md) for the component
this protocol belongs to; [`docs/decisions/001-mock-exchange-wire-protocol.md`](../decisions/001-mock-exchange-wire-protocol.md)
for why the format looks like this; [`docs/decisions/002-slow-consumer-policy.md`](../decisions/002-slow-consumer-policy.md)
for the full reasoning behind §6's sequence-number contract.
