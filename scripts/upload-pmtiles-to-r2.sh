#!/usr/bin/env bash
#
# Upload a PMTiles file to the R2 bucket (same credentials as build-pmtiles.sh).
#
# Usage:
#   ./scripts/upload-pmtiles-to-r2.sh path/to/file.pmtiles
#   ./scripts/upload-pmtiles-to-r2.sh path/to/file.pmtiles tiles/custom-name.pmtiles
#
# Requires: .env.r2 with R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -f "$PROJECT_DIR/.env.r2" ]; then
  set -a
  source "$PROJECT_DIR/.env.r2"
  set +a
else
  echo "ERROR: .env.r2 not found in $PROJECT_DIR"
  echo "Create it with: R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=..."
  exit 1
fi

INPUT_FILE="${1:-}"
R2_KEY="${2:-}"  # optional: e.g. tiles/montreal-custom.pmtiles

if [ -z "$INPUT_FILE" ] || [ ! -f "$INPUT_FILE" ]; then
  echo "Usage: $0 <path/to/file.pmtiles> [r2-key]"
  echo "  r2-key defaults to tiles/$(basename "$INPUT_FILE")"
  exit 1
fi

BASENAME="$(basename "$INPUT_FILE")"
DIR="$(cd "$(dirname "$INPUT_FILE")" && pwd)"
R2_KEY="${R2_KEY:-tiles/$BASENAME}"
R2_ENDPOINT="${R2_ENDPOINT:-https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com}"

# Windows path for Docker mount (Git Bash / MSYS)
win_path=$(cd "$DIR" && pwd -W 2>/dev/null || echo "$DIR" | sed 's|^/c/|C:/|')

echo "Uploading $INPUT_FILE -> s3://${R2_BUCKET}/${R2_KEY}"
if MSYS_NO_PATHCONV=1 docker run --rm \
  -v "${win_path}:/data" \
  -e AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  -e AWS_DEFAULT_REGION="auto" \
  amazon/aws-cli \
  s3 cp "/data/${BASENAME}" "s3://${R2_BUCKET}/${R2_KEY}" \
  --endpoint-url "$R2_ENDPOINT" \
  --region auto \
  --content-type "application/vnd.pmtiles"; then
  echo "Done. URL: https://pub-${R2_ACCOUNT_ID}.r2.dev/${R2_KEY}"
else
  echo "Upload failed. Common fixes:"
  echo "  1. R2 endpoint must be https://<ACCOUNT_ID>.r2.cloudflarestorage.com (no path)"
  echo "  2. API token needs 'Object Read & Write' for the bucket"
  echo "  3. R2_BUCKET must match the bucket name in Cloudflare R2 dashboard"
  exit 1
fi
