#!/usr/bin/env bash
# PostToolUse hook (Edit|Write|MultiEdit): typecheck + run the vitest suite after a
# source-file edit under client/Tckr.MarketWatch/src. Runs the whole suite rather than
# trying to guess a "related" test file by name — this repo's test files are named after
# the behavior they cover, not the source file (TickDispatcher.ts -> dispatcher.*.test.ts,
# SimulatedSource.ts -> simulated.*.test.ts), so name-matching would miss real breakage.
set -euo pipefail

payload="$(cat)"
file="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty')"

[ -z "$file" ] && exit 0

case "$file" in
  *.ts | *.tsx) ;;
  *) exit 0 ;;
esac

proj="/Users/fadi/Work/Tckr/client/Tckr.MarketWatch"
case "$file" in
  "$proj"/src/*) ;;
  *) exit 0 ;;
esac

cd "$proj"

errors=""

if ! tc_out="$(npm run -s typecheck 2>&1)"; then
  errors="${errors}TYPECHECK FAILED:
${tc_out}

"
fi

if ! test_out="$(npx vitest run 2>&1)"; then
  errors="${errors}TESTS FAILED:
${test_out}

"
fi

if [ -n "$errors" ]; then
  reason="$(printf '%s' "$errors" | head -c 4000)"
  jq -n --arg reason "$reason" \
    '{decision:"block", reason: $reason, hookSpecificOutput:{hookEventName:"PostToolUse"}}'
fi

exit 0
