#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEFAULT_IC_DIR="$ROOT_DIR/.render/oracle/instantclient"
IC_DIR="${INSTANT_CLIENT_PATH:-$DEFAULT_IC_DIR}"

if [ -d "$IC_DIR" ]; then
  if [ ! -f "$IC_DIR/libclntsh.so" ]; then
    LATEST_CLNTSH="$(find "$IC_DIR" -maxdepth 1 -type f -name "libclntsh.so.*" | sort -V | tail -n 1 | xargs -I{} basename {})"
    if [ -n "${LATEST_CLNTSH:-}" ]; then
      ln -sfn "$LATEST_CLNTSH" "$IC_DIR/libclntsh.so"
    fi
  fi

  if [ ! -f "$IC_DIR/libnnz.so" ]; then
    LATEST_NNZ="$(find "$IC_DIR" -maxdepth 1 -type f -name "libnnz*.so*" | sort -V | tail -n 1 | xargs -I{} basename {})"
    if [ -n "${LATEST_NNZ:-}" ]; then
      ln -sfn "$LATEST_NNZ" "$IC_DIR/libnnz.so"
    fi
  fi

  if [ ! -f "$IC_DIR/libclntsh.so" ] || [ ! -f "$IC_DIR/libnnz.so" ]; then
    echo "Instant Client found but required libraries are missing in: $IC_DIR"
    ls -la "$IC_DIR"
    exit 1
  fi

  export INSTANT_CLIENT_PATH="$IC_DIR"
  export LD_LIBRARY_PATH="$IC_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

exec node server.js
