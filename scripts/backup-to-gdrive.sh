#!/usr/bin/env bash
# backup-to-gdrive.sh
#
# Backs up the rmp.ca repository to Google Drive using rclone + a service account.
#
# Requirements:
#   - rclone installed (apt install rclone  /  https://rclone.org/install)
#   - A Google Cloud service account JSON key with access to the target Drive
#     (either "My Drive" via domain-wide delegation, or a shared folder)
#
# Usage:
#   GDRIVE_SA_JSON=/path/to/sa.json [GDRIVE_FOLDER_ID=<folder-id>] bash scripts/backup-to-gdrive.sh
#
# Environment variables:
#   GDRIVE_SA_JSON   Path to the Google service account key JSON file (required)
#   GDRIVE_FOLDER_ID Google Drive folder ID to upload into (optional; defaults to root "My Drive")
#   BACKUP_NAME      Override the archive filename (default: rmp.ca-<date>.bundle)
#
# Setup (one-time):
#   1. Go to https://console.cloud.google.com and create (or reuse) a project.
#   2. Enable the "Google Drive API" for the project.
#   3. Create a Service Account: IAM & Admin → Service Accounts → + Create.
#   4. Create a key for it (JSON), download it, and place it somewhere safe
#      (e.g. /home/user/gdrive-sa.json  —  do NOT commit it to the repo).
#   5. If you want to upload to a specific folder instead of root Drive:
#      a. Create the folder in Google Drive.
#      b. Share the folder with the service account's email address (from the JSON).
#      c. Copy the folder ID from the URL:
#         https://drive.google.com/drive/folders/<FOLDER_ID>
#   6. Run this script with the env vars above.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATE="$(date -u +%Y%m%d-%H%M%S)"
BACKUP_NAME="${BACKUP_NAME:-rmp.ca-${DATE}.bundle}"
BUNDLE_TMP="/tmp/${BACKUP_NAME}"

# ── Validate inputs ────────────────────────────────────────────────────────────
if [[ -z "${GDRIVE_SA_JSON:-}" ]]; then
  echo "ERROR: GDRIVE_SA_JSON is not set."
  echo "  Export the path to your service account JSON key, e.g.:"
  echo "    export GDRIVE_SA_JSON=/home/user/gdrive-sa.json"
  exit 1
fi

if [[ ! -f "$GDRIVE_SA_JSON" ]]; then
  echo "ERROR: Service account file not found: $GDRIVE_SA_JSON"
  exit 1
fi

if ! command -v rclone &>/dev/null; then
  echo "ERROR: rclone is not installed. Install with:"
  echo "  sudo apt install rclone  OR  curl https://rclone.org/install.sh | sudo bash"
  exit 1
fi

# ── Create git bundle ──────────────────────────────────────────────────────────
echo ">> Creating git bundle: $BUNDLE_TMP"
git -C "$REPO_ROOT" bundle create "$BUNDLE_TMP" --all
echo "   Bundle size: $(du -sh "$BUNDLE_TMP" | cut -f1)"

# ── Build rclone remote on-the-fly (no config file needed) ────────────────────
# rclone can use a service account JSON directly via --drive-service-account-file.
# We build a temporary rclone config pointing at the root of the SA's Drive.
RCLONE_CONFIG_TMP="$(mktemp /tmp/rclone-XXXXXX.conf)"
trap 'rm -f "$RCLONE_CONFIG_TMP" "$BUNDLE_TMP"' EXIT

if [[ -n "${GDRIVE_FOLDER_ID:-}" ]]; then
  ROOT_FOLDER_ID="$GDRIVE_FOLDER_ID"
  echo ">> Uploading to Google Drive folder: $ROOT_FOLDER_ID"
else
  ROOT_FOLDER_ID=""
  echo ">> Uploading to root of Google Drive (service account's My Drive)"
fi

cat > "$RCLONE_CONFIG_TMP" <<EOF
[gdrive]
type = drive
service_account_file = ${GDRIVE_SA_JSON}
EOF

if [[ -n "$ROOT_FOLDER_ID" ]]; then
  echo "root_folder_id = ${ROOT_FOLDER_ID}" >> "$RCLONE_CONFIG_TMP"
fi

# ── Upload ─────────────────────────────────────────────────────────────────────
echo ">> Uploading ${BACKUP_NAME} to Google Drive..."
rclone --config "$RCLONE_CONFIG_TMP" \
  copyto "$BUNDLE_TMP" "gdrive:${BACKUP_NAME}" \
  --progress \
  --transfers 4 \
  --checkers 8

echo ""
echo "Done! Backup uploaded as: ${BACKUP_NAME}"
echo ""
echo "To restore:"
echo "  git clone /path/to/${BACKUP_NAME} rmp.ca-restored"
