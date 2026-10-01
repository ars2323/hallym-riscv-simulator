#!/usr/bin/env bash
# SessionStart hook: make RARS and the probe ready in every session, cloud or local.
# Runs probe/setup.sh (no root, idempotent) and builds the probe classes if stale.
# A JDK must already be installed; if not, setup.sh says so loudly and this hook fails.
set -euo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
export RARS_HOME="${RARS_HOME:-${XDG_CACHE_HOME:-$HOME/.cache}/hallym-riscv/rars}"
t0=$(date +%s%N)

probe/setup.sh

classes=probe/build/classes/RarsProbe.class
if [ ! -f "$classes" ] || [ -n "$(find probe/src -name '*.java' -newer "$classes" -print -quit)" ]; then
  probe/run.sh build
else
  echo "session-start: probe classes up to date"
fi

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export RARS_HOME=\"$RARS_HOME\"" >> "$CLAUDE_ENV_FILE"
  echo "export RARS_JAR=\"$RARS_HOME/rars1_6.jar\"" >> "$CLAUDE_ENV_FILE"
fi
echo "session-start: done in $(( ($(date +%s%N) - t0) / 1000000 )) ms"
