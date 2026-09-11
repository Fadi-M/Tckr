#!/usr/bin/env python3
"""Scenario 10 (determinism) helper: capture a fixed number of tick frames off the raw wire.

Task 09 owns benchmarks/phase-2/**; this is a small standalone script, not a modification of the
probe (tools/Tckr.FeedProbe, owned by task 08) or the protocol (src/.../Protocol, owned by task 01).

Why this exists rather than reusing the probe: the probe's --output JSON is *decoded and
aggregated* data (rates, percentiles, distributions) -- exactly what you want for every other
scenario, and exactly not what "byte-identical tapes" needs. Determinism has to be checked against
the raw bytes on the wire, hashed, not against a statistical summary of them.

What is captured, and why:
  * The SessionStart frame (type 11) is read and discarded. It carries a random-per-connection
    session GUID and a real wall-clock connect time -- neither is part of "the tape", both are
    per-connection metadata that will differ on every run by construction, deterministic generator
    or not.
  * Heartbeat frames (type 10) are skipped. FeedSession stamps heartbeats with a real wall-clock
    timestamp (UtcNowNanos()) regardless of GenerationOptions.DeterministicTimestamps -- that flag
    only swaps the clock the *generator* uses for FeedRecord.ExchangeTimestampNanos. A heartbeat is
    a liveness signal about the connection, not a market data record, so it is correctly outside
    the determinism claim.
  * Trade / BidQuote / AskQuote frames (types 1-3) are the tape. Every byte of every such frame,
    INCLUDING ExchangeTimestampNanos, is kept and hashed unmasked -- masking the timestamp field
    before comparing was explicitly rejected in task 09's brief ("do not implement tape comparison
    by masking the timestamp field... it quietly degrades into 'we compared everything except the
    field most likely to differ'"). With DeterministicTimestamps=true the timestamp is exactly
    reproducible, so there is nothing to mask.

Usage:
    python3 capture_tape.py --host 127.0.0.1 --port 9001 --count 5000 --output tape.bin \
        [--timeout 30]

Exits 0 and writes <count> concatenated 40-byte tick payloads (the on-wire TickPayloadSize) to
--output on success. Exits 1 with a message on stderr if the connection drops or --timeout is
reached before --count tick frames are collected.
"""
from __future__ import annotations

import argparse
import socket
import struct
import sys
import time

MSG_TRADE = 1
MSG_BID = 2
MSG_ASK = 3
MSG_HEARTBEAT = 10
MSG_SESSION_START = 11

TICK_PAYLOAD_SIZE = 40


def recv_exact(sock: socket.socket, n: int, deadline: float) -> bytes:
    buf = bytearray()
    while len(buf) < n:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError(f"timed out waiting for {n} bytes (had {len(buf)})")
        sock.settimeout(remaining)
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("connection closed by peer")
        buf.extend(chunk)
    return bytes(buf)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=9001)
    p.add_argument("--count", type=int, default=5000, help="tick frames to capture")
    p.add_argument("--output", required=True)
    p.add_argument("--timeout", type=float, default=30.0, help="overall deadline, seconds")
    args = p.parse_args()

    deadline = time.monotonic() + args.timeout

    # Retry-connect rather than a single attempt. This matters more than it looks: during
    # development, synchronizing on the exchange's "Feed server listening" *log line* (poll a
    # redirected-to-file log until the text appears, then connect) reproducibly gave DIFFERENT
    # tapes across runs with an identical seed -- not a small, explainable offset, but two stable
    # clusters of hashes with no alignment findable even 200,000 records (8s at 25,000/s) deep.
    # RandomWalkGenerator.Next() was read to confirm it draws a fixed 4 RNG values per event
    # regardless of batch chunking, so the *generator* is not the source of that divergence.
    # Root cause: generation starts as soon as FeedPublisherService's loop runs (right after the
    # listener binds), continuing whether or not anyone is connected, by design (see the mock
    # exchange README's design decision #4). Console output to a redirected file is not flushed
    # synchronously with the bind, so "the log line is visible to a polling reader" lags "the
    # listener is actually accepting" by a real, *variable* amount -- and every event generated
    # in that gap is generated-and-discarded before a probe (log-line-triggered) ever connects.
    # Racing the socket directly instead of waiting on the log closes that gap: three fresh
    # processes connected this way (connect latency ~78-85ms, i.e. real process/JIT startup time,
    # not log-flush jitter) produced byte-identical tapes on every run. Kept in the capture tool
    # itself, not just the caller, so anyone re-running scenario 10 gets the fix automatically.
    sock = None
    while sock is None:
        try:
            sock = socket.create_connection((args.host, args.port), timeout=0.2)
        except (ConnectionRefusedError, OSError):
            if time.monotonic() >= deadline:
                print("capture_tape failed: could not connect before --timeout", file=sys.stderr)
                return 1
            time.sleep(0.005)
    try:
        # First frame on every accepted connection is SessionStart (4-byte LE length prefix +
        # 32-byte payload == FeedFrameWriter.SessionStartFrameSize). Read and discard it.
        header = recv_exact(sock, 4, deadline)
        (length,) = struct.unpack("<I", header)
        payload = recv_exact(sock, length, deadline)
        if payload[1] != MSG_SESSION_START:
            print(f"expected SessionStart (type 11) as the first frame, got type {payload[1]}", file=sys.stderr)
            return 1

        collected = 0
        with open(args.output, "wb") as out:
            while collected < args.count:
                header = recv_exact(sock, 4, deadline)
                (length,) = struct.unpack("<I", header)
                payload = recv_exact(sock, length, deadline)
                msg_type = payload[1]
                if msg_type in (MSG_TRADE, MSG_BID, MSG_ASK):
                    if length != TICK_PAYLOAD_SIZE:
                        print(f"unexpected tick payload size {length} (want {TICK_PAYLOAD_SIZE})", file=sys.stderr)
                        return 1
                    out.write(payload)
                    collected += 1
                elif msg_type == MSG_HEARTBEAT:
                    continue  # real wall-clock, not part of the tape -- see module docstring
                else:
                    print(f"unexpected message type {msg_type} while capturing tape", file=sys.stderr)
                    return 1

        print(f"captured {collected} tick frames ({collected * TICK_PAYLOAD_SIZE} bytes) to {args.output}")
        return 0
    except (TimeoutError, ConnectionError, OSError) as exc:
        print(f"capture_tape failed: {exc}", file=sys.stderr)
        return 1
    finally:
        sock.close()


if __name__ == "__main__":
    raise SystemExit(main())
