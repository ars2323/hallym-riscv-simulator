#!/usr/bin/env bash
# Installs what the probe needs into $RARS_HOME (default ~/.cache/hallym-riscv/rars):
#   rars1_6.jar     released jar, v1.6 (sha256 checked)
#   src/            RARS source at the pinned commit (+ jsoftfloat submodule)
#   rars-src.jar    built from src/ with RARS's own build-jar.sh
# Needs no root. A JDK with javac and jlink must already be on PATH; this script does
# not install one (that needs root, which only the environment's setup script has).
# Idempotent: when everything is in place it only re-checks the hash and the commit.
set -euo pipefail
RARS_HOME="${RARS_HOME:-${XDG_CACHE_HOME:-$HOME/.cache}/hallym-riscv/rars}"
RARS_COMMIT=7acf3254e84ab75fa612402b22fe915a2e00bdab        # tag v1.6
RARS_JAR_URL=https://github.com/TheThirdOne/rars/releases/download/v1.6/rars1_6.jar
RARS_JAR_SHA256=780f730eb457b1ba609e968accc2c8b77d8f92c3d9dbf30cc7fdb3cfb14e8c24

for tool in java javac jlink git curl sha256sum; do
  if ! command -v "$tool" >/dev/null; then
    echo "setup: FAIL: '$tool' not on PATH. Install a JDK 17+ (with jlink) via the environment setup script; this script does not use root." >&2
    exit 1
  fi
done

mkdir -p "$RARS_HOME"
jar="$RARS_HOME/rars1_6.jar"
if [ -f "$jar" ] && [ "$(sha256sum "$jar" | cut -d' ' -f1)" = "$RARS_JAR_SHA256" ]; then
  echo "setup: rars1_6.jar present, hash ok"
else
  echo "setup: downloading rars1_6.jar"
  curl -fsSL --retry 4 -o "$jar.part" "$RARS_JAR_URL"
  got="$(sha256sum "$jar.part" | cut -d' ' -f1)"
  if [ "$got" != "$RARS_JAR_SHA256" ]; then
    echo "setup: FAIL: rars1_6.jar sha256 $got, expected $RARS_JAR_SHA256" >&2
    exit 1
  fi
  mv "$jar.part" "$jar"
fi

head="$(git -C "$RARS_HOME/src" rev-parse HEAD 2>&1 || true)"
if [ "$head" = "$RARS_COMMIT" ]; then
  echo "setup: RARS source at $RARS_COMMIT"
else
  echo "setup: cloning RARS source at $RARS_COMMIT"
  rm -rf "$RARS_HOME/src" "$RARS_HOME/rars-src.jar"
  git clone -q https://github.com/TheThirdOne/rars.git "$RARS_HOME/src"
  git -C "$RARS_HOME/src" checkout -q "$RARS_COMMIT"
  git -C "$RARS_HOME/src" submodule update --init -q
fi
if [ -f "$RARS_HOME/rars-src.jar" ]; then
  echo "setup: rars-src.jar present"
else
  echo "setup: building rars-src.jar with RARS's build-jar.sh"
  (cd "$RARS_HOME/src" && ./build-jar.sh)
  mv "$RARS_HOME/src/rars.jar" "$RARS_HOME/rars-src.jar"
  rm -rf "$RARS_HOME/src/build"
  # RARS itself must stay untouched; only untracked build output is allowed.
  if [ -n "$(git -C "$RARS_HOME/src" status --porcelain --untracked-files=no)" ]; then
    echo "setup: FAIL: RARS source tree was modified by the build" >&2
    git -C "$RARS_HOME/src" status --short >&2
    exit 1
  fi
fi
echo "setup: ok, RARS_HOME=$RARS_HOME"
