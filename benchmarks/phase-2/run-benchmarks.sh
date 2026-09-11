#!/usr/bin/env bash
# Task 09 — runs the Phase 2 throughput benchmark matrix end to end.
#
# Usage:
#   ./benchmarks/phase-2/run-benchmarks.sh                     # scenarios 1,2,3,4,5,6,7,10 (default)
#   ./benchmarks/phase-2/run-benchmarks.sh 3                   # just the acceptance run
#   ./benchmarks/phase-2/run-benchmarks.sh 1 2 3 4 5 6 7 8 9 10 # everything, including the
#                                                                 # 5-minute phases run and the
#                                                                 # 30-minute soak
#
# Env vars:
#   RUNS=3                 repeats per scenario (minimum 3 per the brief's honesty rules)
#   MEASURE_SECONDS=15      steady-state seconds for the short/diagnostic scenarios (1,2,4,5,6,7)
#                            -- NOT scenario 3, which is hard-coded to the mandated 60s, and NOT
#                            8/9, which use their own brief-mandated durations when run at all.
#   WARMUP_SECONDS=5        warm-up seconds excluded from measurement (brief says 10; shortened to
#                            5 for the non-acceptance scenarios to fit the session's time budget --
#                            see results.md for the explicit call-out of which scenarios used which
#                            durations. Scenario 3 always uses the full 10s.)
#   HOST=127.0.0.1 PORT=9001
#
# Every run's raw probe JSON, exchange log, dotnet-counters CSV and ps sample CSV land under
# benchmarks/phase-2/raw/<scenario>/run<N>/ (git-ignored past the JSON; see .gitignore).
#
# This script does not itself write results.md -- it produces the raw material. The numbers in
# results.md were transcribed from these files by hand so the honesty rules in the brief
# (median + spread over 3 runs, never a fabricated figure) are visibly satisfied by files on disk.

set -uo pipefail  # NOT -e: a scenario's probe exiting non-zero (e.g. scenario 7's stalled leg,
                   # by design per task 08's notes) must not abort the whole matrix.

# shellcheck source=./common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

RUNS="${RUNS:-3}"
MEASURE_SECONDS="${MEASURE_SECONDS:-15}"
WARMUP_SECONDS="${WARMUP_SECONDS:-5}"
BP2_HOST="${HOST:-127.0.0.1}"
BP2_PORT="${PORT:-9001}"

SCENARIOS=("$@")
if [ "${#SCENARIOS[@]}" -eq 0 ]; then
    SCENARIOS=(1 2 3 4 5 6 7 10)
fi

bp2_ensure_build
mkdir -p "$BP2_RAW_DIR"

# run_single <scenario_dir> <run_index> <warmup_s> <measure_s> <exchange_env_string> \
#            <probe_extra_args_string> [second_probe_extra_args_string]
#
# env/probe args are passed as a single space-separated string (word-split on use; every token
# used in this script is a plain KEY=VALUE or --flag [value] with no embedded spaces, so this is
# safe) rather than by array name/nameref -- the macOS system bash is 3.2, which has no `local -n`.
#
# Starts the exchange with the given env, waits warmup_s, launches one (or two, for scenario 7)
# probes for measure_s, collects dotnet-counters + ps samples over the same window, stops the
# exchange. Writes everything under raw/<scenario_dir>/run<run_index>/.
run_single() {
    local scen="$1" run_idx="$2" warmup="$3" measure="$4"
    local env_str="$5" probe_str="$6" probe2_str="${7:-}"
    local -a env_arr probe_arr probe2_arr
    env_arr=($env_str)
    probe_arr=($probe_str)

    local dir="$BP2_RAW_DIR/$scen/run$run_idx"
    mkdir -p "$dir"

    bp2_log "[$scen run $run_idx] starting exchange (env: ${env_str:-<defaults>})"
    if ! bp2_start_exchange "$dir/exchange.log" "${env_arr[@]}"; then
        bp2_err "[$scen run $run_idx] exchange failed to start; skipping this run"
        echo "SKIPPED: exchange failed to start" > "$dir/FAILED"
        return 1
    fi
    local ex_pid="$BP2_EX_PID"

    bp2_log "[$scen run $run_idx] warm-up ${warmup}s (excluded from measurement)"
    sleep "$warmup"

    local ps_pid
    ps_pid="$(bp2_sample_ps "$ex_pid" exchange "$dir/exchange_ps.csv" 5)"

    bp2_start_counters "$ex_pid" "$measure" "$dir/counters.csv"
    local counters_pid="$BP2_COUNTERS_PID"

    bp2_log "[$scen run $run_idx] measuring ${measure}s"
    if [ -n "$probe2_str" ]; then
        probe2_arr=($probe2_str)
        bp2_run_probe "$dir/probe.json" "$dir/probe.log" --duration "$measure" "${probe_arr[@]}" &
        local p1=$!
        bp2_run_probe "$dir/probe2.json" "$dir/probe2.log" --duration "$measure" "${probe2_arr[@]}" &
        local p2=$!
        wait "$p1"; local e1=$?
        wait "$p2"; local e2=$?
        echo "$e1" > "$dir/probe.exit"
        echo "$e2" > "$dir/probe2.exit"
    else
        bp2_run_probe "$dir/probe.json" "$dir/probe.log" --duration "$measure" "${probe_arr[@]}"
        echo "$BP2_PROBE_EXIT" > "$dir/probe.exit"
    fi

    [ -n "$counters_pid" ] && bp2_wait_bounded "$counters_pid" 15
    kill "$ps_pid" 2>/dev/null; wait "$ps_pid" 2>/dev/null

    bp2_stop_exchange "$ex_pid"
    bp2_log "[$scen run $run_idx] done"
}

run_scenario_repeats() {
    # run_scenario_repeats <scenario_dir> <warmup> <measure> <env_string> <probe_args_string> \
    #                       [second_probe_args_string]
    local scen="$1" warmup="$2" measure="$3" env_str="$4" probe_str="$5" probe2_str="${6:-}"
    for i in $(seq 1 "$RUNS"); do
        run_single "$scen" "$i" "$warmup" "$measure" "$env_str" "$probe_str" "$probe2_str"
    done
}

for s in "${SCENARIOS[@]}"; do
case "$s" in

1)
    bp2_log "=== Scenario 1: Baseline (1,000/s, 1 consumer) ==="
    env1="MockExchange__Session__BaseEventsPerSecond=1000 MockExchange__Feed__ListenAddress=127.0.0.1"
    probe1="--target-rate 1000 --verify-order"
    run_scenario_repeats "s1_baseline" "$WARMUP_SECONDS" "$MEASURE_SECONDS" "$env1" "$probe1"
    ;;

2)
    bp2_log "=== Scenario 2: Ramp (5K / 10K / 25K/s, 1 consumer) ==="
    for rate in 5000 10000 25000; do
        env2="MockExchange__Session__BaseEventsPerSecond=$rate MockExchange__Feed__ListenAddress=127.0.0.1"
        probe2="--target-rate $rate"
        run_scenario_repeats "s2_ramp_${rate}" "$WARMUP_SECONDS" "$MEASURE_SECONDS" "$env2" "$probe2"
    done
    ;;

3)
    bp2_log "=== Scenario 3: TARGET / Phase 2 acceptance run (25,000/s, 1 consumer, 60s) ==="
    env3="MockExchange__Session__BaseEventsPerSecond=25000 MockExchange__Feed__ListenAddress=127.0.0.1"
    probe3="--target-rate 25000 --verify-order --top-symbols 20"
    run_scenario_repeats "s3_target_25k" 10 60 "$env3" "$probe3"
    ;;

4)
    bp2_log "=== Scenario 4: Headroom (50K / 100K/s, 1 consumer) ==="
    for rate in 50000 100000; do
        env4="MockExchange__Session__BaseEventsPerSecond=$rate MockExchange__Session__MaxEventsPerSecond=$rate MockExchange__Feed__ListenAddress=127.0.0.1"
        probe4="--target-rate $rate"
        run_scenario_repeats "s4_headroom_${rate}" "$WARMUP_SECONDS" "$MEASURE_SECONDS" "$env4" "$probe4"
    done
    ;;

5)
    bp2_log "=== Scenario 5: Fan-out (25,000/s, 1/2/4/8 consumers) ==="
    for n in 1 2 4 8; do
        scen="s5_fanout_${n}"
        for i in $(seq 1 "$RUNS"); do
            dir="$BP2_RAW_DIR/$scen/run$i"
            mkdir -p "$dir"
            env5=(MockExchange__Session__BaseEventsPerSecond=25000 MockExchange__Feed__ListenAddress=127.0.0.1)
            bp2_log "[$scen run $i] starting exchange"
            if ! bp2_start_exchange "$dir/exchange.log" "${env5[@]}"; then
                echo "SKIPPED: exchange failed to start" > "$dir/FAILED"; continue
            fi
            ex_pid="$BP2_EX_PID"
            sleep "$WARMUP_SECONDS"
            ps_pid="$(bp2_sample_ps "$ex_pid" exchange "$dir/exchange_ps.csv" 5)"
            bp2_start_counters "$ex_pid" "$MEASURE_SECONDS" "$dir/counters.csv"
            counters_pid="$BP2_COUNTERS_PID"
            pids=()
            for c in $(seq 1 "$n"); do
                bp2_run_probe "$dir/probe_${c}.json" "$dir/probe_${c}.log" \
                    --duration "$MEASURE_SECONDS" --target-rate 25000 &
                pids+=($!)
            done
            for pid in "${pids[@]}"; do wait "$pid"; done
            [ -n "$counters_pid" ] && bp2_wait_bounded "$counters_pid" 15
            kill "$ps_pid" 2>/dev/null; wait "$ps_pid" 2>/dev/null
            bp2_stop_exchange "$ex_pid"
            bp2_log "[$scen run $i] done ($n concurrent consumers)"
        done
    done
    ;;

6)
    bp2_log "=== Scenario 6: Universe (25,000/s, 50/250/1000/10000 symbols) ==="
    for size in 50 250 1000 10000; do
        env6="MockExchange__Session__BaseEventsPerSecond=25000 MockExchange__Generation__UniverseSize=$size MockExchange__Feed__ListenAddress=127.0.0.1"
        probe6="--target-rate 25000 --top-symbols 20"
        run_scenario_repeats "s6_universe_${size}" "$WARMUP_SECONDS" "$MEASURE_SECONDS" "$env6" "$probe6"
    done
    ;;

7)
    bp2_log "=== Scenario 7: Slow consumer (25,000/s, 1 healthy + 1 stalled) ==="
    for policy in Disconnect DropOldest; do
        scen="s7_slowconsumer_${policy}"
        envh="MockExchange__Session__BaseEventsPerSecond=25000 MockExchange__Feed__SlowConsumerPolicy=$policy MockExchange__Feed__ListenAddress=127.0.0.1"
        probe_healthy="--target-rate 25000"
        if [ "$policy" = "DropOldest" ]; then
            probe_stalled="--target-rate 25000 --stall-after 5 --stall-duration 5 --expect-drops"
        else
            probe_stalled="--target-rate 25000 --stall-after 5 --stall-duration 5"
        fi
        run_scenario_repeats "$scen" "$WARMUP_SECONDS" 20 "$envh" "$probe_healthy" "$probe_stalled"
    done
    ;;

8)
    bp2_log "=== Scenario 8: Phases (CompressedDay, 5 min) ==="
    env8="MockExchange__Session__BaseEventsPerSecond=25000 MockExchange__Session__Mode=CompressedDay MockExchange__Session__CompressedDurationMinutes=5 MockExchange__Feed__ListenAddress=127.0.0.1"
    probe8="--target-rate 25000 --report-interval 10"
    run_scenario_repeats "s8_phases_compressedday" "$WARMUP_SECONDS" 300 "$env8" "$probe8"
    ;;

9)
    bp2_log "=== Scenario 9: Soak (25,000/s, 30 min) ==="
    env9="MockExchange__Session__BaseEventsPerSecond=25000 MockExchange__Feed__ListenAddress=127.0.0.1"
    probe9="--target-rate 25000 --report-interval 30"
    run_scenario_repeats "s9_soak_30min" 10 1800 "$env9" "$probe9"
    ;;

10)
    bp2_log "=== Scenario 10: Determinism (same seed, DeterministicTimestamps=true, two+ runs, 10s) ==="
    scen="s10_determinism"
    for i in $(seq 1 "$RUNS"); do
        dir="$BP2_RAW_DIR/$scen/run$i"
        mkdir -p "$dir"
        env10=(MockExchange__Session__BaseEventsPerSecond=5000 MockExchange__Generation__UniverseSize=250 \
               MockExchange__Generation__Seed=20260907 MockExchange__Generation__DeterministicTimestamps=true \
               MockExchange__Feed__ListenAddress=127.0.0.1)
        bp2_log "[$scen run $i] starting exchange (nowait -- see capture_tape.py for why)"
        # Deliberately NOT bp2_start_exchange: waiting for the "Feed server listening" log line
        # to become visible in a redirected-to-file log reproducibly desynchronized the tape
        # across runs, because that visibility lags the real listener bind by a variable amount
        # while generation keeps running (and discarding output) regardless. capture_tape.py
        # races the raw socket instead, which is the tight synchronization point.
        bp2_start_exchange_nowait "$dir/exchange.log" "${env10[@]}"
        ex_pid="$BP2_EX_PID"
        python3 "$BP2_SCRIPT_DIR/capture_tape.py" --host "$BP2_HOST" --port "$BP2_PORT" \
            --count 5000 --output "$dir/tape.bin" --timeout 15
        capture_exit=$?
        echo "$capture_exit" > "$dir/capture.exit"
        if [ "$capture_exit" -ne 0 ]; then
            bp2_err "[$scen run $i] tape capture failed (exit $capture_exit); exchange log follows:"
            cat "$dir/exchange.log" >&2
            bp2_stop_exchange "$ex_pid"
            continue
        fi
        shasum -a 256 "$dir/tape.bin" 2>/dev/null | awk '{print $1}' > "$dir/tape.sha256" || \
            sha256sum "$dir/tape.bin" | awk '{print $1}' > "$dir/tape.sha256"
        bp2_stop_exchange "$ex_pid"
        bp2_log "[$scen run $i] tape hash: $(cat "$dir/tape.sha256")"
    done
    ;;

*)
    bp2_err "unknown scenario '$s' (valid: 1-10)"
    ;;
esac
done

bp2_log "Matrix complete for scenarios: ${SCENARIOS[*]}"
bp2_log "Raw output under: $BP2_RAW_DIR"
