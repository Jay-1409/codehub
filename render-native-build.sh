#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
ORACLE_DIR="$ROOT_DIR/.render/oracle"
ZIP_URL="https://download.oracle.com/otn_software/linux/instantclient/2380000/instantclient-basiclite-linux.x64-23.8.0.25.04.zip"
ZIP_PATH="$ORACLE_DIR/instantclient-basiclite.zip"
STABLE_LINK="$ORACLE_DIR/instantclient"

mkdir -p "$ORACLE_DIR"

if ! find "$ORACLE_DIR" -maxdepth 1 -type d -name "instantclient_*" | grep -q .; then
  echo "Downloading Oracle Instant Client..."
  curl -fsSL "$ZIP_URL" -o "$ZIP_PATH"
  unzip -oq "$ZIP_PATH" -d "$ORACLE_DIR"
  rm -f "$ZIP_PATH"
fi

EXTRACTED_DIR="$(find "$ORACLE_DIR" -maxdepth 1 -type d -name "instantclient_*" | sort -V | tail -n 1)"
if [ -z "$EXTRACTED_DIR" ]; then
  echo "Oracle Instant Client extraction failed."
  exit 1
fi

ln -sfn "$EXTRACTED_DIR" "$STABLE_LINK"

# Ensure common linker names exist for runtime loading.
if [ ! -f "$STABLE_LINK/libclntsh.so" ]; then
  LATEST_CLNTSH="$(find "$STABLE_LINK" -maxdepth 1 -type f -name "libclntsh.so.*" | sort -V | tail -n 1 | xargs -I{} basename {})"
  if [ -n "${LATEST_CLNTSH:-}" ]; then
    ln -sfn "$LATEST_CLNTSH" "$STABLE_LINK/libclntsh.so"
  fi
fi

if [ ! -f "$STABLE_LINK/libnnz.so" ]; then
  LATEST_NNZ="$(find "$STABLE_LINK" -maxdepth 1 -type f -name "libnnz*.so*" | sort -V | tail -n 1 | xargs -I{} basename {})"
  if [ -n "${LATEST_NNZ:-}" ]; then
    ln -sfn "$LATEST_NNZ" "$STABLE_LINK/libnnz.so"
  fi
fi

echo "Oracle Instant Client path: $STABLE_LINK"
ls -1 "$STABLE_LINK" | grep -E "^lib(clntsh|nnz)" || true

npm ci
npm run build
