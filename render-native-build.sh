#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
ORACLE_DIR="$ROOT_DIR/.render/oracle"
SYSLIB_DIR="$ORACLE_DIR/syslib"
ZIP_URL="https://download.oracle.com/otn_software/linux/instantclient/2380000/instantclient-basic-linux.x64-23.8.0.25.04.zip"
ZIP_PATH="$ORACLE_DIR/instantclient-basic.zip"
STABLE_LINK="$ORACLE_DIR/instantclient"
ORACLE_DRIVER_MODE="${ORACLE_DRIVER_MODE:-thin}"

if [ "$ORACLE_DRIVER_MODE" != "thick" ]; then
  echo "ORACLE_DRIVER_MODE=$ORACLE_DRIVER_MODE -> skipping Oracle Instant Client setup (Thin mode)."
  npm ci --include=dev
  npm run build
  exit 0
fi

mkdir -p "$ORACLE_DIR"
mkdir -p "$SYSLIB_DIR"

download_file_from_list() {
  local out_file="$1"
  shift
  for url in "$@"; do
    if curl -fsSL "$url" -o "$out_file"; then
      echo "Downloaded: $url"
      return 0
    fi
  done
  return 1
}

extract_deb() {
  local deb_file="$1"
  local target_dir="$2"

  if command -v dpkg-deb >/dev/null 2>&1; then
    dpkg-deb -x "$deb_file" "$target_dir"
    return 0
  fi

  if ! command -v ar >/dev/null 2>&1; then
    echo "Neither dpkg-deb nor ar found; cannot extract $deb_file"
    return 1
  fi

  local tmp_extract
  tmp_extract="$(mktemp -d)"
  (cd "$tmp_extract" && ar x "$deb_file")

  if [ -f "$tmp_extract/data.tar.xz" ]; then
    tar -xJf "$tmp_extract/data.tar.xz" -C "$target_dir"
  elif [ -f "$tmp_extract/data.tar.gz" ]; then
    tar -xzf "$tmp_extract/data.tar.gz" -C "$target_dir"
  else
    echo "No data archive found inside $deb_file"
    rm -rf "$tmp_extract"
    return 1
  fi

  rm -rf "$tmp_extract"
}

ensure_syslib() {
  local so_name="$1"
  shift
  local urls=("$@")

  if find "$SYSLIB_DIR" -type f -name "$so_name*" | grep -q .; then
    return 0
  fi

  local deb_file
  deb_file="$(mktemp)"
  if ! download_file_from_list "$deb_file" "${urls[@]}"; then
    rm -f "$deb_file"
    echo "Failed to download package for $so_name"
    return 1
  fi

  if ! extract_deb "$deb_file" "$SYSLIB_DIR"; then
    rm -f "$deb_file"
    echo "Failed to extract package for $so_name"
    return 1
  fi

  rm -f "$deb_file"
  return 0
}

echo "Preparing Linux shared libraries for Oracle Thick mode..."
ensure_syslib "libaio.so.1" \
  "http://archive.ubuntu.com/ubuntu/pool/main/liba/libaio/libaio1_0.3.112-13build1_amd64.deb" \
  "http://archive.ubuntu.com/ubuntu/pool/main/liba/libaio/libaio1_0.3.112-13_amd64.deb" \
  "http://security.ubuntu.com/ubuntu/pool/main/liba/libaio/libaio1_0.3.112-13build1_amd64.deb" || true

# Optional fallback for some Oracle client builds that look for libnsl.
ensure_syslib "libnsl.so" \
  "http://archive.ubuntu.com/ubuntu/pool/main/libn/libnsl/libnsl2_1.3.0-2build2_amd64.deb" \
  "http://archive.ubuntu.com/ubuntu/pool/main/libn/libnsl/libnsl2_1.3.0-2_amd64.deb" \
  "http://security.ubuntu.com/ubuntu/pool/main/libn/libnsl/libnsl2_1.3.0-2build2_amd64.deb" || true

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

if [ ! -f "$STABLE_LINK/libclntsh.so" ] || [ ! -f "$STABLE_LINK/libnnz.so" ]; then
  echo "Oracle client libs missing after setup. Found:"
  ls -la "$STABLE_LINK"
  exit 1
fi

if find "$SYSLIB_DIR" -type f -name 'libaio.so.1*' | grep -q .; then
  echo "Prepared libaio files:"
  find "$SYSLIB_DIR" -type f -name 'libaio.so.1*' -print
else
  echo "Warning: libaio.so.1 not found in vendored syslib; Thick mode may fail at runtime."
fi

npm ci --include=dev
npm run build
