#!/usr/bin/env bash
# Usage: probe/run.sh build | checks | bench | all
# RARS_JAR defaults to the released jar installed by probe/setup.sh.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export RARS_JAR="${RARS_JAR:-${RARS_HOME:-/opt/rars}/rars1_6.jar}"
[ -f "$RARS_JAR" ] || { echo "RARS_JAR=$RARS_JAR not found; run probe/setup.sh" >&2; exit 1; }
echo "RARS_JAR=$RARS_JAR"

build() {
  rm -rf "$HERE/build/classes"; mkdir -p "$HERE/build/classes"
  javac --release 11 -cp "$RARS_JAR" -d "$HERE/build/classes" "$HERE/src/RarsProbe.java"
}

case "${1:-all}" in
  build)  build ;;
  checks) python3 "$HERE/checks.py" ;;
  bench)  python3 "$HERE/bench.py" ;;
  all)    build; python3 "$HERE/bench.py"; python3 "$HERE/checks.py" "$HERE/build/jlink/min" ;;
  *) echo "unknown: $1" >&2; exit 2 ;;
esac
