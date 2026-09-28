#!/usr/bin/env bash
# PostToolUse hook (Edit|Write|MultiEdit): fast feedback after a source edit under src/ or
# perf/: the project typecheck (~1.5 s) plus ESLint on the edited file (~2 s), so an
# architecture-boundary import or a hooks-rule break surfaces on the edit that caused it.
# The full test suite runs once per turn in stop-definition-of-done.sh, not per edit.
set -euo pipefail

proj="$(cd "$(dirname "$0")/../.." && pwd)"
file="$(jq -r '.tool_input.file_path // empty')"

case "$file" in
  "$proj"/src/*.ts | "$proj"/src/*.tsx | "$proj"/perf/*.ts) ;;
  *) exit 0 ;;
esac
[ -f "$file" ] || exit 0

cd "$proj"
errors=""

if ! out="$(npm run -s typecheck 2>&1)"; then
  errors+="TYPECHECK FAILED:"$'\n'"$out"$'\n\n'
fi
if ! out="$(npx eslint --max-warnings=0 "$file" 2>&1)"; then
  errors+="LINT FAILED:"$'\n'"$out"$'\n'
fi

if [ -n "$errors" ]; then
  jq -n --arg reason "$(printf '%s' "$errors" | head -c 4000)" \
    '{decision: "block", reason: $reason, hookSpecificOutput: {hookEventName: "PostToolUse"}}'
fi
exit 0
