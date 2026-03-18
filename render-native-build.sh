#!/usr/bin/env bash
set -euo pipefail

echo "Docker deployment is the supported path."
echo "Use the Dockerfile for Oracle Thick mode setup."

npm ci --include=dev
npm run build
