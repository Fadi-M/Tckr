#!/usr/bin/env bash
# Task 09 — capture the environment every benchmark run in this directory was taken on.
#
# Writes benchmarks/phase-2/raw/env.txt (overwritten each run — it describes the machine, not a
# single benchmark run) and echoes the same text to stdout so it can be pasted straight into
# results.md's "Environment" section.
#
# Usage: ./benchmarks/phase-2/capture-env.sh [output-file]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RAW_DIR="$SCRIPT_DIR/raw"
OUT="${1:-$RAW_DIR/env.txt}"

mkdir -p "$RAW_DIR"

# dotnet SDK ships dotnet-counters (and friends) under ~/.dotnet/tools, which is not always on
# PATH in a fresh shell even when the tool is installed. Add it defensively.
export PATH="$PATH:$HOME/.dotnet/tools"

{
    echo "Tckr Phase 2 — Benchmark Environment"
    echo "Captured: $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    echo "======================================================================"
    echo
    echo "-- Git --"
    echo "Commit:  $(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo 'unknown (not a git checkout?)')"
    echo "Branch:  $(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
    dirty="$(git -C "$ROOT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
    echo "Dirty:   ${dirty:-0} uncommitted change(s) at capture time"
    echo
    echo "-- CPU --"
    if command -v sysctl >/dev/null 2>&1; then
        echo "Model:            $(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo unknown)"
        echo "Physical cores:   $(sysctl -n hw.physicalcpu 2>/dev/null || echo unknown)"
        echo "Logical cores:    $(sysctl -n hw.logicalcpu 2>/dev/null || echo unknown)"
        hz="$(sysctl -n hw.cpufrequency 2>/dev/null || true)"
        if [ -n "${hz:-}" ]; then
            echo "Base clock:       $(( hz / 1000000 )) MHz"
        else
            echo "Base clock:       not reported by sysctl on this platform (Apple silicon does not expose hw.cpufrequency; see 'sysctl machdep.cpu' for perf/efficiency core split if needed)"
        fi
    elif [ -f /proc/cpuinfo ]; then
        echo "Model:            $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2- | sed 's/^ //')"
        echo "Physical cores:   $(grep -c '^processor' /proc/cpuinfo)"
        echo "Logical cores:    $(nproc 2>/dev/null || echo unknown)"
    else
        echo "Model/cores:      unknown (neither sysctl nor /proc/cpuinfo available)"
    fi
    echo
    echo "-- RAM --"
    if command -v sysctl >/dev/null 2>&1; then
        mem_bytes="$(sysctl -n hw.memsize 2>/dev/null || echo 0)"
        echo "Total:            $(( mem_bytes / 1024 / 1024 / 1024 )) GB"
    elif [ -f /proc/meminfo ]; then
        echo "Total:            $(grep MemTotal /proc/meminfo | awk '{printf "%.1f GB\n", $2/1024/1024}')"
    fi
    echo
    echo "-- OS / kernel --"
    if command -v sw_vers >/dev/null 2>&1; then
        echo "OS:               macOS $(sw_vers -productVersion) (build $(sw_vers -buildVersion))"
    fi
    echo "Kernel:           $(uname -srm)"
    echo
    echo "-- .NET --"
    echo "$(dotnet --version 2>/dev/null | sed 's/^/SDK version:      /')"
    echo
    echo "dotnet --info:"
    dotnet --info 2>&1 | sed 's/^/  /'
    echo
    echo "-- dotnet-counters --"
    if command -v dotnet-counters >/dev/null 2>&1; then
        echo "Available: $(dotnet-counters --version 2>&1 | head -1)"
    else
        echo "NOT FOUND on PATH (checked \$PATH and ~/.dotnet/tools) — GC/ThreadPool counters in this"
        echo "report would fall back to GC.GetTotalAllocatedBytes()/ps if this were the case."
    fi
    echo
    echo "-- Build configuration --"
    echo "All benchmark numbers in results.md are from Release builds only (dotnet build src/Tckr.slnx -c Release)."
    echo "Tckr.MockExchange.csproj sets ServerGarbageCollection=true, ConcurrentGarbageCollection=true"
    echo "(see the csproj comment: this process is throughput-oriented and gets its own GC heap/thread"
    echo "rather than contending with socket writes for one; background collection keeps a gen2 out of"
    echo "the middle of a benchmark window)."
    echo "TieredCompilation / TieredPGO: left at their .NET 10 defaults (both on) — not overridden by"
    echo "the csproj or by any benchmark script env var."
    echo
    echo "-- Topology --"
    echo "Tckr.MockExchange (the load source) and Tckr.FeedProbe (the measuring client) run on the"
    echo "SAME host for every Phase 2 run — there is no second machine available. This means:"
    echo "  * Delivery-latency figures in every scenario are same-host-clock figures, not network"
    echo "    latency; they become unreliable the moment ingestion and exchange are on separate boxes."
    echo "  * Every CPU% figure reported is 'this host running both processes', not the exchange alone."
    echo "    Where it matters, results.md reports the exchange process and the probe process separately"
    echo "    (via 'ps -o pcpu,rss -p <pid>' sampled every 5s) so the split is visible."
    echo
    echo "======================================================================"
} | tee "$OUT"

echo
echo "Environment capture written to: $OUT" >&2
