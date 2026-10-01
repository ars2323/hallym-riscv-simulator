#!/usr/bin/env bash
# Installs what the probe needs into $RARS_HOME (default /opt/rars):
#   rars1_6.jar           released jar, v1.6
#   src/                  RARS source at the pinned commit (+ jsoftfloat submodule)
#   rars-src.jar          built from src/ with RARS's own build-jar.sh
# A JDK with jlink is required; installed via apt if missing.
# Idempotent. Meant to be pasted into the cloud environment's setup script too.
set -euo pipefail
RARS_HOME="${RARS_HOME:-/opt/rars}"
RARS_TAG=v1.6
RARS_COMMIT=7acf3254e84ab75fa612402b22fe915a2e00bdab        # tag v1.6
RARS_JAR_URL=https://github.com/TheThirdOne/rars/releases/download/v1.6/rars1_6.jar
RARS_JAR_SHA256=780f730eb457b1ba609e968accc2c8b77d8f92c3d9dbf30cc7fdb3cfb14e8c24

if ! command -v jlink >/dev/null; then
  echo "setup: no jlink; installing openjdk-21-jdk-headless"
  apt-get update -q && apt-get install -y -q openjdk-21-jdk-headless
fi
java -version

mkdir -p "$RARS_HOME"
if ! echo "$RARS_JAR_SHA256  $RARS_HOME/rars1_6.jar" | sha256sum -c --status 2>&1; then
  curl -fsSL --retry 4 -o "$RARS_HOME/rars1_6.jar" "$RARS_JAR_URL"
  echo "$RARS_JAR_SHA256  $RARS_HOME/rars1_6.jar" | sha256sum -c
fi

if [ "$(git -C "$RARS_HOME/src" rev-parse HEAD 2>&1)" != "$RARS_COMMIT" ]; then
  rm -rf "$RARS_HOME/src"
  git clone -q https://github.com/TheThirdOne/rars.git "$RARS_HOME/src"
  git -C "$RARS_HOME/src" checkout -q "$RARS_COMMIT"
  git -C "$RARS_HOME/src" submodule update --init -q
fi
if [ ! -f "$RARS_HOME/rars-src.jar" ]; then
  (cd "$RARS_HOME/src" && ./build-jar.sh)
  cp "$RARS_HOME/src/rars.jar" "$RARS_HOME/rars-src.jar"
  git -C "$RARS_HOME/src" status --short   # build artefacts only; sources untouched
fi
echo "setup: RARS $RARS_TAG commit $RARS_COMMIT in $RARS_HOME"
ls -l "$RARS_HOME"/*.jar
