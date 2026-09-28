#!/usr/bin/env bash
# Stop hook: the mechanical part of GUIDELINES.md §Definition of done. Before Claude ends a
# turn that changed code, typecheck, lint, and the full vitest suite must pass; otherwise the
# stop is blocked and the failures are fed back.
#
# - Skips when nothing under src/, perf/, scripts/ or the lint/build config differs from the
#   last passing state (a hash of the working-tree diff is stamped on success), so
#   conversation-only turns cost nothing.
# - Loop guard: while `stop_hook_active` is true (Claude is already continuing because of
#   this hook), it blocks at most MAX_BLOCKS times in a row, then lets the stop through
#   with the failure left visible, so a failure Claude cannot fix never traps the session.
set -euo pipefail

MAX_BLOCKS=3
proj="$(cd "$(dirname "$0")/../.." && pwd)"
state_dir="$proj/.claude/.state"
stamp="$state_dir/dod-pass"
blocks="$state_dir/dod-blocks"
mkdir -p "$state_dir"

active="$(jq -r '.stop_hook_active // false')"
cd "$proj"

watched=(src perf scripts eslint.config.js vite.config.ts tsconfig.json tsconfig.node.json package.json)
fingerprint="$(
  {
    git diff HEAD -- "${watched[@]}"
    git ls-files --others --exclude-standard -- "${watched[@]}" | while read -r f; do
      printf '%s\n' "$f"
      cat "$f"
    done
  } | shasum | cut -d' ' -f1
)"

if [ "$(git diff HEAD --quiet -- "${watched[@]}"; echo $?)" = 0 ] &&
  [ -z "$(git ls-files --others --exclude-standard -- "${watched[@]}")" ]; then
  rm -f "$blocks"
  exit 0
fi
if [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$fingerprint" ]; then
  rm -f "$blocks"
  exit 0
fi

errors=""
if ! out="$(npm run -s typecheck 2>&1)"; then
  errors+="TYPECHECK FAILED:"$'\n'"$(printf '%s' "$out" | tail -40)"$'\n\n'
fi
if ! out="$(npx eslint --max-warnings=0 . 2>&1)"; then
  errors+="LINT FAILED:"$'\n'"$(printf '%s' "$out" | tail -40)"$'\n\n'
fi
if ! out="$(npx vitest run 2>&1)"; then
  errors+="TESTS FAILED:"$'\n'"$(printf '%s' "$out" | grep -E 'FAIL|✗|×|Error|expected|Test Files|Tests ' | head -60)"$'\n'
fi

if [ -z "$errors" ]; then
  printf '%s' "$fingerprint" >"$stamp"
  rm -f "$blocks"
  exit 0
fi

count=0
if [ "$active" = "true" ] && [ -f "$blocks" ]; then
  count="$(cat "$blocks")"
fi
if [ "$count" -ge "$MAX_BLOCKS" ]; then
  rm -f "$blocks"
  echo "Definition of done still failing after $MAX_BLOCKS attempts; stopping so the user can decide." >&2
  exit 0
fi
echo $((count + 1)) >"$blocks"

jq -n --arg reason "Definition of done is not met (GUIDELINES.md §Definition of done). Fix these before finishing, or explain to the user why you cannot:
$(printf '%s' "$errors" | head -c 6000)" '{decision: "block", reason: $reason}'
exit 0
