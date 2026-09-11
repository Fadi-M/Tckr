#!/usr/bin/env bash
# Shared helpers for benchmarks/phase-2/run-benchmarks.sh. Not a standalone entry point.

# --- paths -------------------------------------------------------------------------------------

BP2_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BP2_ROOT="$(cd "$BP2_SCRIPT_DIR/../.." && pwd)"
BP2_RAW_DIR="$BP2_SCRIPT_DIR/raw"
BP2_EXCHANGE_PROJDIR="$BP2_ROOT/src/Tckr.MockExchange"
BP2_EXCHANGE_DLL="$BP2_EXCHANGE_PROJDIR/bin/Release/net10.0/Tckr.MockExchange.dll"
BP2_PROBE_DLL="$BP2_ROOT/tools/Tckr.FeedProbe/bin/Release/net10.0/Tckr.FeedProbe.dll"

export PATH="$PATH:$HOME/.dotnet/tools"

bp2_log() { echo "[$(date -u +%H:%M:%S)] $*" >&2; }
bp2_err() { echo "[$(date -u +%H:%M:%S)] ERROR: $*" >&2; }

# --- build --------------------------------------------------------------------------------------

bp2_ensure_build() {
    if [ ! -f "$BP2_EXCHANGE_DLL" ] || [ ! -f "$BP2_PROBE_DLL" ] || [ "${BP2_FORCE_BUILD:-0}" = "1" ]; then
        bp2_log "Building src/Tckr.slnx (Release)..."
        (cd "$BP2_ROOT" && dotnet build src/Tckr.slnx -c Release) || { bp2_err "build failed"; exit 1; }
    fi
}

# --- exchange lifecycle ---------------------------------------------------------------------

# bp2_start_exchange <logfile> [ENV_KEY=VALUE ...]
# Sets BP2_EX_PID on success. Content root MUST be the project directory (appsettings.json lives
# there) -- invoking the DLL from any other cwd silently loses every appsettings.json value
# because Microsoft.Extensions.Configuration's JSON file provider is registered `optional: true`
# and just skips a file it can't find at the (cwd-derived) content root. This bit this exact
# benchmark task during development: a Seed of 20260907 (the file) silently became 6071779539582010692
# (the C# default) and Port 9001 became 5001, with no error anywhere. `dotnet run --project` hides
# this because it sets cwd to the project directory itself; invoking the built DLL directly, which
# this script does for reliable PID tracking, does not.
bp2_start_exchange() {
    local logfile="$1"; shift
    : > "$logfile"
    (
        cd "$BP2_EXCHANGE_PROJDIR" || exit 1
        exec env DOTNET_ENVIRONMENT=Production "$@" dotnet bin/Release/net10.0/Tckr.MockExchange.dll
    ) >> "$logfile" 2>&1 &
    BP2_EX_PID=$!

    local waited=0
    while [ "$waited" -lt 200 ]; do # 20s at 0.1s steps
        if grep -q "Feed server listening" "$logfile" 2>/dev/null; then
            return 0
        fi
        if ! kill -0 "$BP2_EX_PID" 2>/dev/null; then
            bp2_err "exchange process exited before it started listening; log follows:"
            cat "$logfile" >&2
            return 1
        fi
        sleep 0.1
        waited=$((waited + 1))
    done
    bp2_err "exchange did not log 'Feed server listening' within 20s"
    cat "$logfile" >&2
    return 1
}

# bp2_start_exchange_nowait <logfile> [ENV_KEY=VALUE ...]
# Launches the exchange and returns immediately (sets BP2_EX_PID) without waiting for the
# "Feed server listening" log line. Used only by scenario 10 (determinism): see the long comment
# in capture_tape.py for why -- waiting on that log line (redirected-to-file stdout is not
# flushed synchronously with the socket bind) lets a real, variable amount of generation happen
# before a log-line-triggered connect, which reproducibly desynchronized otherwise byte-identical
# tapes. capture_tape.py itself retry-connects against the raw socket, which is the tight
# synchronization point; this function just avoids adding the log-wait's delay on top of it.
bp2_start_exchange_nowait() {
    local logfile="$1"; shift
    : > "$logfile"
    (
        cd "$BP2_EXCHANGE_PROJDIR" || exit 1
        exec env DOTNET_ENVIRONMENT=Production "$@" dotnet bin/Release/net10.0/Tckr.MockExchange.dll
    ) >> "$logfile" 2>&1 &
    BP2_EX_PID=$!
}

# bp2_stop_exchange <pid>
bp2_stop_exchange() {
    local pid="$1"
    [ -z "$pid" ] && return 0
    kill -TERM "$pid" 2>/dev/null || return 0
    local waited=0
    while [ "$waited" -lt 50 ]; do # 5s
        kill -0 "$pid" 2>/dev/null || return 0
        sleep 0.1
        waited=$((waited + 1))
    done
    bp2_err "exchange pid $pid did not exit within 5s of SIGTERM; sending SIGKILL"
    kill -KILL "$pid" 2>/dev/null || true
}

# --- sampling -------------------------------------------------------------------------------

# bp2_sample_ps <pid> <label> <outcsv> [interval_seconds]
# Runs in the background until killed with the returned PID (callers use `kill "$ps_pid"`, not
# bp2_wait_bounded -- this loop only exits on its own once the sampled process dies).
#
# TRAP: this is always called as `x="$(bp2_sample_ps ...)"` to capture the background PID via
# `echo $!`. If the backgrounded loop is not explicitly redirected away from stdout, it inherits
# the command-substitution's stdout pipe -- and since the loop is still alive (by design) when the
# function itself returns, bash never sees EOF on that pipe and the `$(...)` call hangs forever,
# even though `echo $!` already ran. Cost a full debugging pass to `bash -n`. Every backgrounded
# job started from inside a function whose result is captured with `$(...)` needs this.
bp2_sample_ps() {
    local pid="$1" label="$2" outcsv="$3" interval="${4:-5}"
    echo "elapsed_s,label,pid,pcpu,pmem,rss_kb,vsz_kb" > "$outcsv"
    (
        local t=0
        while kill -0 "$pid" 2>/dev/null; do
            local line
            line="$(ps -o pcpu=,pmem=,rss=,vsz= -p "$pid" 2>/dev/null | tr -s ' ')"
            [ -n "$line" ] && echo "$t,$label,$pid,$(echo "$line" | tr ' ' ',' | sed 's/^,//')" >> "$outcsv"
            sleep "$interval"
            t=$((t + interval))
        done
    ) >/dev/null 2>&1 &
    echo $!
}

# bp2_start_counters <pid> <duration_seconds> <outcsv>
# Returns the dotnet-counters background PID via BP2_COUNTERS_PID; caller should `wait` on it (it
# exits on its own once --duration elapses) rather than kill it.
#
# TRAP: `dotnet-counters collect --duration` takes dd:hh:mm:ss, NOT a bare integer of seconds.
# Passing a bare integer (e.g. `--duration 8`) is silently accepted by the CLI parser and then
# ignored -- the process never stops on its own and just collects forever until killed. Hit this
# during development: a plain `--duration 8` run was still alive and still writing rows to the CSV
# two minutes later. Always format as dd:hh:mm:ss.
bp2_start_counters() {
    local pid="$1" duration_s="$2" outcsv="$3"
    if ! command -v dotnet-counters >/dev/null 2>&1; then
        bp2_err "dotnet-counters not on PATH; GC/ThreadPool counters will be skipped for this run" \
                "(falls back to whatever ps captured for CPU/RSS; documented in results.md)."
        BP2_COUNTERS_PID=""
        return 1
    fi
    rm -f "$outcsv"
    local dd hh mm ss rem
    dd=$((duration_s / 86400)); rem=$((duration_s % 86400))
    hh=$((rem / 3600)); rem=$((rem % 3600))
    mm=$((rem / 60)); ss=$((rem % 60))
    local duration_fmt
    duration_fmt="$(printf '%02d:%02d:%02d:%02d' "$dd" "$hh" "$mm" "$ss")"
    dotnet-counters collect --process-id "$pid" --counters System.Runtime \
        -o "$outcsv" --format csv --duration "$duration_fmt" \
        > "${outcsv%.csv}.counters.log" 2>&1 &
    BP2_COUNTERS_PID=$!
}

# --- probe ------------------------------------------------------------------------------------

# bp2_run_probe <outjson> <outlog> [extra probe args...]
# Sets BP2_PROBE_EXIT. Always uses --host/--port from BP2_HOST/BP2_PORT unless overridden by args.
bp2_run_probe() {
    local outjson="$1" outlog="$2"; shift 2
    dotnet "$BP2_PROBE_DLL" --host "${BP2_HOST:-127.0.0.1}" --port "${BP2_PORT:-9001}" \
        --output "$outjson" "$@" > "$outlog" 2>&1
    BP2_PROBE_EXIT=$?
    return "$BP2_PROBE_EXIT"
}

# --- small helpers used when writing results.md ----------------------------------------------

# bp2_median <values...> -> prints the median of the given numbers (bash arithmetic, integers or
# decimals via awk).
# bp2_wait_bounded <pid> <max_extra_seconds>
# Waits for a background pid to exit, but never longer than max_extra_seconds past the call --
# after that it force-kills it. Defensive belt-and-braces: a single misbehaving dotnet-counters
# invocation (see the --duration format trap above) should cost one run's GC numbers, not the rest
# of the matrix.
bp2_wait_bounded() {
    local pid="$1" max_extra="${2:-15}" waited=0
    [ -z "$pid" ] && return 0
    while kill -0 "$pid" 2>/dev/null; do
        if [ "$waited" -ge "$max_extra" ]; then
            bp2_err "pid $pid did not exit within ${max_extra}s grace; force-killing"
            kill -KILL "$pid" 2>/dev/null || true
            break
        fi
        sleep 1
        waited=$((waited + 1))
    done
    wait "$pid" 2>/dev/null
}

bp2_median() {
    printf '%s\n' "$@" | sort -n | awk '
        { a[NR]=$1 }
        END {
            if (NR % 2 == 1) print a[(NR+1)/2]
            else print (a[NR/2] + a[NR/2+1]) / 2
        }'
}
