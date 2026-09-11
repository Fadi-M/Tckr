#!/usr/bin/env python3
"""Task 09 helper: summarize a scenario's raw runs (probe JSON + dotnet-counters CSV + ps CSV)
into the numbers results.md quotes. Not part of the required capture-env.sh/run-benchmarks.sh
pair (those two are the scripts the brief names); this is a convenience so the numbers written
into results.md are computed from the files on disk rather than eyeballed and transcribed by hand.

Usage:
    python3 aggregate.py benchmarks/phase-2/raw/s3_target_25k

Prints, per run and as a median-and-spread summary across runs: achieved rate / % of target,
sequence gaps, inter-arrival and delivery latency p99, wire throughput, message mix, and -- from
the dotnet-counters CSV -- Gen0/1/2 collection counts and total allocated bytes over the window,
plus mean/max exchange CPU% and RSS from the ps CSV.

GC note: dotnet-counters' CSV export reports each System.Runtime meter as a per-second Rate
sample (the underlying counters are monotonic; dotnet-counters converts to a rate at the
--refresh-interval, 1s here). Summing the per-second Rate samples over a run approximates the
total count/bytes for that run -- it is not a raw before/after delta of the cumulative counter,
which the CSV export does not expose directly. Documented here rather than silently assumed.
"""
from __future__ import annotations

import csv
import json
import statistics
import sys
from pathlib import Path


def median_spread(values):
    if not values:
        return None, None
    med = statistics.median(values)
    spread = (max(values) - min(values)) if len(values) > 1 else 0.0
    return med, spread


def load_probe(run_dir: Path, name: str = "probe.json"):
    p = run_dir / name
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except Exception as exc:  # noqa: BLE001
        print(f"  WARN: could not parse {p}: {exc}", file=sys.stderr)
        return None


def summarize_counters(run_dir: Path):
    p = run_dir / "counters.csv"
    if not p.exists():
        return None
    gen0 = gen1 = gen2 = 0.0
    allocated = 0.0
    max_queue = 0.0
    pause_samples = []
    with p.open(newline="") as f:
        reader = csv.reader(f)
        header = next(reader, None)
        for row in reader:
            if len(row) < 5:
                continue
            _, provider, name, ctype, value = row[:5]
            try:
                v = float(value)
            except ValueError:
                continue
            if "gc.collections" in name and "gen0" in name:
                gen0 += v
            elif "gc.collections" in name and "gen1" in name:
                gen1 += v
            elif "gc.collections" in name and "gen2" in name:
                gen2 += v
            elif "gc.heap.total_allocated" in name:
                allocated += v
            elif "thread_pool.queue.length" in name:
                max_queue = max(max_queue, v)
            elif "gc.pause.time" in name:
                pause_samples.append(v)
    return {
        "gen0_collections": round(gen0, 1),
        "gen1_collections": round(gen1, 1),
        "gen2_collections": round(gen2, 1),
        "allocated_bytes_approx": int(allocated),
        "max_threadpool_queue_length": max_queue,
        "max_gc_pause_time_fraction_per_sample": max(pause_samples) if pause_samples else None,
    }


def summarize_ps(run_dir: Path, label_filter: str | None = None):
    p = run_dir / "exchange_ps.csv"
    if not p.exists():
        return None
    cpus, rss = [], []
    with p.open(newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if label_filter and row.get("label") != label_filter:
                continue
            try:
                cpus.append(float(row["pcpu"]))
                rss.append(float(row["rss_kb"]))
            except (KeyError, ValueError):
                continue
    if not cpus:
        return None
    return {
        "cpu_mean": round(statistics.mean(cpus), 1),
        "cpu_max": round(max(cpus), 1),
        "rss_kb_max": max(rss),
    }


def main():
    if len(sys.argv) < 2:
        print(f"usage: {sys.argv[0]} <scenario_dir> [probe_filename]", file=sys.stderr)
        return 2
    scen_dir = Path(sys.argv[1])
    probe_name = sys.argv[2] if len(sys.argv) > 2 else "probe.json"

    run_dirs = sorted([d for d in scen_dir.iterdir() if d.is_dir() and d.name.startswith("run")])
    if not run_dirs:
        print(f"no run* directories under {scen_dir}", file=sys.stderr)
        return 1

    achieved_rates, target_pcts, gap_counts, p99_jitter, p99_latency = [], [], [], [], []
    bytes_per_sec = []
    gen0s, gen1s, gen2s, allocs = [], [], [], []
    cpu_means, cpu_maxes = [], []

    print(f"=== {scen_dir.name} ({len(run_dirs)} runs) ===")
    for rd in run_dirs:
        probe = load_probe(rd, probe_name)
        counters = summarize_counters(rd)
        ps = summarize_ps(rd, "exchange")

        if probe and probe.get("sessionEstablished", True):
            ar = probe.get("achievedRate", {})
            achieved_rates.append(ar.get("overall"))
            target_pcts.append(ar.get("targetPercent"))
            gap_counts.append(probe.get("sequence", {}).get("gapCount"))
            p99_jitter.append(probe.get("interArrivalMs", {}).get("p99"))
            p99_latency.append(probe.get("deliveryLatencyMs", {}).get("p99"))
            bytes_per_sec.append(probe.get("wire", {}).get("bytesPerSecond"))
            print(f"  {rd.name}: achieved={ar.get('overall'):.1f}/s ({ar.get('targetPercent'):.1f}%) "
                  f"gaps={probe.get('sequence', {}).get('gapCount')} "
                  f"p99jitter={probe.get('interArrivalMs', {}).get('p99')}ms "
                  f"p99lat={probe.get('deliveryLatencyMs', {}).get('p99')}ms "
                  f"exit={probe.get('exitCode')}")
        else:
            print(f"  {rd.name}: no probe data ({probe_name} missing or session not established)")

        if counters:
            gen0s.append(counters["gen0_collections"])
            gen1s.append(counters["gen1_collections"])
            gen2s.append(counters["gen2_collections"])
            allocs.append(counters["allocated_bytes_approx"])
            print(f"    gc: gen0~{counters['gen0_collections']} gen1~{counters['gen1_collections']} "
                  f"gen2~{counters['gen2_collections']} alloc~{counters['allocated_bytes_approx']:,}B "
                  f"maxThreadPoolQueue={counters['max_threadpool_queue_length']}")
        if ps:
            cpu_means.append(ps["cpu_mean"])
            cpu_maxes.append(ps["cpu_max"])
            print(f"    exchange ps: cpu_mean={ps['cpu_mean']}% cpu_max={ps['cpu_max']}% "
                  f"rss_max={ps['rss_kb_max']/1024:.1f}MB")

    print("--- median / spread across runs ---")
    for label, series in [
        ("achieved rate", achieved_rates), ("target %", target_pcts), ("gap count", gap_counts),
        ("p99 jitter ms", p99_jitter), ("p99 latency ms", p99_latency),
        ("bytes/sec", bytes_per_sec), ("gen0 collections", gen0s), ("gen1 collections", gen1s),
        ("gen2 collections", gen2s), ("allocated bytes", allocs),
        ("exchange cpu mean %", cpu_means), ("exchange cpu max %", cpu_maxes),
    ]:
        vals = [v for v in series if v is not None]
        med, spread = median_spread(vals)
        if med is not None:
            print(f"  {label}: median={med:.3g} spread={spread:.3g} (n={len(vals)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
