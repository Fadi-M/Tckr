# ADR 002 — Slow consumers are disconnected, not thinned

- **Status:** Accepted
- **Date:** 2026-09-10
- **Phase:** 2 — Mock Exchange
- **Deciders:** Task 05 (implementation and the mid-task correction), coordinator Fadi Matta

This is the most defensible decision in Phase 2, and the one most likely to be
challenged — because the first version of the argument for it was wrong, and the
record of *how* it was wrong is more valuable than the decision itself.

## Context

A real exchange does not slow down because a consumer is slow, and neither does this
one — that is settled at the Phase 2 design level (`docs/phase-2-mock-exchange/README.md`
§4, decision 4: "the exchange never blocks on a consumer"). What is not settled going
in is what happens to the consumer that cannot keep up with a sequenced 25,000/sec
feed: `FeedServer`/`FeedSession` (task 05) has to pick a policy for a session whose
outbound buffer is full.

## Decision

Bounded per-session buffer (`SessionBufferBytes`, default 4 MiB). When a session cannot
drain fast enough and stays behind past `SlowConsumerTimeoutMs`, the default policy is
**`Disconnect`**: the session is closed. `DropOldest` — discard the oldest still-queued
bytes and keep the session alive — exists as a configurable alternative, off by
default, intended for Phase 11 experiments where a different consumer semantics is the
whole point.

## The claim that did not survive implementation

The tempting justification for `Disconnect`, and the one that appears in this phase's
own task brief, is that the alternative is *undetectable*: drop ticks from the middle
of a sequenced feed and the consumer cannot tell corruption from silence — fine for a
*display* stream that only ever wants the latest value, wrong for a *sequenced* one
where every record is supposed to be accounted for.

As originally implemented, that claim was not just optimistic, it was backwards, and
worse than the usual telling of "drops are invisible." Sequence numbers were assigned
when a record was *written* to a session. A session that fell behind, withheld records
under backpressure, and then recovered simply resumed writing and numbering from where
it left off: the consumer received `1, 2, 3, …` with no gap at all. Not a gap that
*looks like* corruption — no gap, full stop. A tape thinned in the middle and
relabelled as continuous. That is strictly worse than the failure mode `Disconnect` was
supposed to be protecting against, because a `Disconnect`-shaped argument for
`DropOldest`'s danger was hiding a bug in the thing making `Disconnect` the default.

## The fix, and why it is the real deliverable here

The numbering was wrong, not the argument for a policy. **Sequence numbers now count
every record the session is *offered*, not every record it accepts.** A record withheld
under backpressure, or discarded from the buffer under `DropOldest`, still burns its
number on that session's counter. The consumer sees exactly `records offered so far`
as the running sequence, so a hole in it is precisely the size of what was lost —
`highest_seen − records_received` is the exact loss count, not an estimate. The failure
became self-describing. This is what actually needed fixing; disconnecting so the
thinning could never happen was treating the symptom.

## The honest claim for the default, post-fix

`Disconnect` stays the default, but for a weaker and truer reason than the original
one. **Both policies are now detectable.** They differ in what they promise, not in
whether a consumer can tell what happened:

| | `Disconnect` (default) | `DropOldest` |
|---|---|---|
| Promise | A complete tape, or the session ends | You may lose records, and you will see precisely which |
| On recovery after withholding | Closed anyway (`slow-consumer-loss`) — it can no longer deliver a complete tape | Kept; the gap *is* the disclosure |
| Consumer's recovery logic | Reconnect | Read the gap and carry on |

**Most consumers of a sequenced market feed want a complete tape, and would rather
reconnect than reason about which records they are missing.** That is a contract
preference about what kind of stream this is supposed to be, not a correctness
necessity forced by an undetectable failure mode — because there is no undetectable
failure mode left.

Three details worth recording precisely, because each is easy to get wrong and each
has a test pinned to it:

1. **`slow-consumer-loss` fires only under `Disconnect`, and it fires even when the
   session goes on to drain successfully.** A session that has already withheld records
   cannot deliver a complete tape whatever it does next, so it is closed regardless of
   whether it catches up. Under `DropOldest` this must never fire — that policy's
   entire contract is that disclosed loss is acceptable — and it does not. Without this
   asymmetry the two policies collapse into one, distinguished only by a timeout.
2. **`DropOldest` discards the oldest bytes still sitting in the pipe, and those bytes
   had already been numbered.** It loses data loudly, by construction, not by
   convention or by accident of timing.
3. **Neither policy can rescue a peer that has stopped reading altogether.** Freeing our
   own buffer does nothing for a wedged socket on the other end, so `DropOldest` also
   ends in a disconnect after `SlowConsumerTimeoutMs` when the socket itself never
   drains. There is a test asserting this specifically, because "`DropOldest` means the
   session survives" is the tempting and wrong reading of the policy's name.

Measured (`05-tcp-feed-server.md`, Feed suite output): a stalled healthy/unhealthy pair
where the slow session took 77 of 200 batches while the healthy session received all
10,000 records with no gap; a slow consumer disconnected 120 ms after backpressure was
detected against a 500 ms timeout, reason `slow-consumer-loss`; and, under `DropOldest`,
3,601 records offered against 901 delivered, 2,700 counted dropped, with the final frame
numbered 3,601 of 3,601 offered — the equality `offered − delivered == dropped` held
across eight consecutive runs with loss volumes from 500 to 4,200 records. Task 08's
probe later confirmed the same equality end-to-end and independently: its decoded gap
size (108,875 and 109,000 records in two live runs) matched the server's own
`RecordsDropped` log line exactly, to the record, in both runs.

## Alternatives Considered

- **Unbounded buffering.** The producer never blocks, but the exchange's own memory
  becomes the slow consumer's problem — one stuck consumer can grow the process without
  bound. Rejected outright; this is the failure mode "the exchange never blocks" exists
  to prevent from resurfacing one layer down.
- **Block the producer** until every session drains. Rejected for the same reason
  restated: the single most important behavioural property of this component is that
  generation runs at its configured rate regardless of who is connected or how slow
  they are. Blocking the producer is the exact failure this whole design exists to
  avoid.
- **Drop oldest / coalesce, as the sole policy.** Fine for a stream whose consumers only
  ever want the latest value (a price display). Wrong as the *only* policy for a
  sequenced feed where every record is supposed to be individually accounted for — but,
  see above, only wrong once the numbering makes the loss visible. With the original
  write-time numbering it was not merely "wrong for a sequenced stream," it was
  actively worse than advertised. Retained as a configurable, opt-in alternative rather
  than rejected outright, because the semantics it offers are exactly right one layer
  up (see below).
- **`Disconnect` (chosen as default).** A complete tape or a clean failure; the
  consumer's job on either policy is now well-defined instead of ambiguous.

## Consequences

- The consumer must implement reconnection to use the default policy at all — which is
  Phase 3's job regardless of this decision, so it costs nothing new.
- Sequence integrity is preserved under `Disconnect`: a consumer that stays connected
  has, by construction, a complete tape.
- The failure is loud in both policies now, in the specific sense that matters: a
  consumer can always tell precisely what happened to its stream, whether that is "you
  were disconnected" or "here is the gap."
- `DropOldest` is not dead weight kept for symmetry — it is the direct evidence that
  Phase 11's WebSocket gateway is allowed to answer the same question differently. See
  below.

## The connection to Phase 11

The gateway faces the identical fork with slow WebSocket clients, and it will very
likely answer it *differently*: a price display genuinely wants latest-value-wins
coalescing, not a reconnect. The reason the two layers can reach opposite answers to
the same-shaped question is not that one layer is right and the other wrong — it is
that **the semantics of the stream decide the policy, not a general preference for
"always disconnect" or "always coalesce."** A sequenced feed that Phase 3 treats as the
authoritative source of an event stream wants a complete tape or a clean failure; a
UI subscription that only ever renders the newest price for a symbol has no use for a
queue of stale ones and every reason to coalesce.

The generalisable point underneath both layers, and the one worth leading with in an
interview: **"what should we do when a consumer is slow?" is downstream of "can the
consumer tell what we did?"**. Fix the observability of the failure first — make loss
self-describing, whichever policy applies — and the policy question gets smaller and
more honest: a preference between two disclosed behaviours, not a choice about whose
data to lose silently. Phase 2 got this backwards on the first pass and corrected it
before it shipped; Phase 11 should not have to rediscover the same lesson.

## Revisit If

- Phase 11's gateway needs a policy this feed's numbering cannot express (for example,
  "tell me how *stale* my latest value is," not just "how many I missed") — that is a
  different disclosure contract and belongs in its own ADR, not a reuse of this one.
- A consumer genuinely wants partial delivery with disclosed loss as its *primary* mode
  rather than an opt-in experiment — at that point `DropOldest` stops being "the
  alternative for Phase 11 experiments" and becomes a first-class supported policy,
  which changes what "default" should mean here.
- The blind spot noted in task 05's notes — records withheld *after* the last one
  actually written are invisible until the next record arrives, so a feed that goes
  permanently quiet immediately after a drop hides that drop — turns out to matter in
  practice. Closing it needs a second heartbeat field carrying the last number
  *offered* (task 01's `SequenceNumber`/heartbeat contract), which was deliberately not
  added in Phase 2 because it widens a frozen frame for a case that has not been
  observed to bite.
