#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
ORACLE_DIR="$ROOT_DIR/.render/oracle"
ZIP_URL="https://download.oracle.com/otn_software/linux/instantclient/2380000/instantclient-basiclite-linux.x64-23.8.0.25.04.zip"
ZIP_PATH="$ORACLE_DIR/instantclient-basiclite.zip"

mkdir -p "$ORACLE_DIR"

if [ ! -d "$ORACLE_DIR/instantclient_23_8" ]; then
  echo "Downloading Oracle Instant Client..."
  curl -fsSL "$ZIP_URL" -o "$ZIP_PATH"
  unzip -oq "$ZIP_PATH" -d "$ORACLE_DIR"
  rm -f "$ZIP_PATH"
fi

npm ci
npm run build
