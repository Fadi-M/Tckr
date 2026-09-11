# ADR 005 — The probe shares `FeedFrameReader` rather than duplicating it

- **Status:** Accepted
- **Date:** 2026-09-10
- **Phase:** 2 — Mock Exchange
- **Deciders:** Task 08, coordinator Fadi Matta

## Context

`Tckr.FeedProbe` (task 08) exists to independently verify the exchange's wire output —
sequence continuity, framing correctness, achieved throughput, symbol distribution. A
verification tool that decodes frames with the *same* code that encoded them is at risk
of a specific failure: a bug in the shared layout logic passes both sides silently,
because there is only one opinion about what the bytes mean, and it agrees with itself
by construction. A verification tool that duplicates the decoder from scratch would be a
genuinely independent second opinion — if the two decoders disagree, something is
actually wrong.

## Decision

The probe uses `FeedFrameReader` directly, via the existing `InternalsVisibleTo`
entry, rather than a second hand-written decoder. `ProbeSession`'s class remarks in
source carry this reasoning as well, since that is where a future reader of the probe's
code would look for it.

The deciding fact is that task 01 already answers the trade-off a duplicated decoder
would exist to settle: the wire layout is pinned by a **hard-coded byte-level regression
test** (`Protocol/` — encode a known record, assert the resulting 44 bytes against a
literal expected array). That test already provides the independence a second decoder
would be trying to buy: any silent field reordering or offset drift fails a test that
has no relationship to `FeedFrameReader`'s own logic, because it asserts against a
constant byte array, not against the reader. A second decoder in the probe would not be
checking the layout against anything further — it would be encoding the same
44/28/36-byte contract a second time, in a second file, with **no test forcing the two
decoders to agree when one of them changes**. That is a maintenance liability dressed up
as independence: two copies of the same knowledge that can silently drift apart, not two
independent checks on the truth.

What the probe is actually meant to be an independent witness to — sequencing, pacing,
achieved rate, symbol distribution, message mix, price sanity — lives entirely *above*
the framing layer. None of those measurements become more trustworthy by re-deriving how
to read a `long` out of a byte span; they become trustworthy by the probe doing its own
counting, timing and distribution analysis on records that both sides already agree how
to decode.

## Alternatives Considered

- **A second, independently hand-written decoder in the probe.** Genuine independent
  implementation evidence — if the probe silently misreads a frame, its own decoder
  bug is exposed by disagreement with the server's rather than reproduced from the same
  source. Rejected on the grounds above: without a test pinning the two decoders to
  agree, the "independence" is illusory (both can drift together, or one can be wrong
  in a way nothing catches), and the byte-level regression test already does the job
  this alternative exists to do.
- **Shared `FeedFrameReader` via `InternalsVisibleTo` (chosen).** One source of truth
  for the wire layout, reachable from the tests, the probe, and (per task 01's brief)
  intended as the reference implementation Phase 3's ingestion parser will port from.
  Costs the independent-implementation evidence described above, in exchange for a
  probe that cannot itself introduce a second, undetected reading of the format.

## Consequences

- **One source of truth for the wire layout.** A change to `FeedFrameReader` — say, to
  support a future version byte — is visible to the probe automatically rather than
  needing a matching edit in a second file that could be forgotten.
- **The probe's evidentiary value shifts, and this should be stated plainly rather than
  glossed over.** It is not independent evidence that the decode logic is correct — the
  byte-level regression test is what carries that weight. It *is* independent evidence
  that the exchange's behaviour is correct: sequencing, pacing, distribution and loss
  accounting are all measured by code the exchange itself has no part in. Task 08's own
  verification (`08-feed-probe.md`) demonstrates exactly this: the probe's independently
  *counted* gap size matched the server's own `RecordsDropped` log line to the record
  across two live `DropOldest` runs (108,875 and 109,000) — that agreement is worth
  something because the counting logic, not the decoding logic, is what the two sides
  each did separately.
- **Phase 3's ingestion parser is explicitly a port of `FeedFrameReader`, not an
  independent implementation either** (task 01's remarks on the type). This decision is
  therefore consistent with the rest of Phase 2's posture toward this file: it is meant
  to be the one place the layout is known, not one of several.
- If `FeedFrameReader` itself has a bug that the byte-level test does not happen to
  exercise, the probe inherits it silently. This is the honest cost of the decision and
  is the reason the Revisit If condition below exists.

## Revisit If

- The byte-level regression test in `Protocol/` is ever weakened, removed, or stops
  covering a field that gets added later — it is the entire justification for not
  duplicating the decoder, and if it stops doing its job this decision loses its
  premise.
- A real, independent-language consumer (not a .NET process reachable via
  `InternalsVisibleTo`) becomes part of Phase 2 or Phase 3's verification story — at
  that point a from-scratch decoder in another language *would* be genuine independent
  evidence, for the same reason a same-language rewrite would not be.
- The probe is ever used to validate a change to `FeedFrameReader` itself (rather than
  to the server's behaviour around it) — in that specific case, sharing the code under
  test with the thing verifying it defeats the purpose, and a scoped, temporary
  duplicate decoder for that one change would be the right call.
