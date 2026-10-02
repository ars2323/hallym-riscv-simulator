#!/usr/bin/env bash
# SessionStart hook: make RARS and the probe ready in every session, cloud or local.
# Runs probe/setup.sh (no root, idempotent), builds the probe classes if stale,
# and installs the Electron app's packages if missing.
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

# The Electron app's packages: only when missing or older than the lock file.  Then the
# Electron binary, which the electron package fetches on first use (cached in ~/.cache/electron):
# fetched here, so no test run waits on a download.
if [ ! -f electron/node_modules/.package-lock.json ] || [ electron/package-lock.json -nt electron/node_modules/.package-lock.json ]; then
  (cd electron && npm ci --no-audit --no-fund)
else
  echo "session-start: electron packages up to date"
fi
[ -x electron/node_modules/electron/dist/electron ] || (cd electron && node -e "require('electron')")

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export RARS_HOME=\"$RARS_HOME\"" >> "$CLAUDE_ENV_FILE"
  echo "export RARS_JAR=\"$RARS_HOME/rars1_6.jar\"" >> "$CLAUDE_ENV_FILE"
fi
echo "session-start: done in $(( ($(date +%s%N) - t0) / 1000000 )) ms"
