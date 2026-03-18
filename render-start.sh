#!/usr/bin/env bash
set -euo pipefail

echo "Docker deployment is the supported path. Starting server..."

exec node server.js
