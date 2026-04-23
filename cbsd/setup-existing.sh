#!/bin/sh
# setup-existing.sh — Provision and deploy to existing CBSD jails.
#
# Usage (as root):
#   cd /path/to/repo
#   cp cbsd/env.sample cbsd/env && edit cbsd/env
#   sudo sh cbsd/setup-existing.sh [--optimizer] [--moonshine] [--all]
#
# This script assumes jails already exist and only runs:
#   1. Provisioning scripts (post-create/)
#   2. Code deployment (deploy.sh)
#   3. Prints follow-up instructions

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

DEPLOY_ARGS=""

for arg in "$@"; do
    case "$arg" in
        --optimizer|--moonshine|--all) DEPLOY_ARGS="${DEPLOY_ARGS} ${arg}" ;;
        -h|--help)
            sed -n '2,/^$/s/^# \?//p' "$0"
            exit 0
            ;;
        *)
            printf 'Unknown option: %s\n' "$arg" >&2
            exit 1
            ;;
    esac
done

info()  { printf '\033[1;34m==> %s\033[0m\n' "$*"; }
warn()  { printf '\033[1;33mWARN: %s\033[0m\n' "$*" >&2; }
die()   { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# ── Load operator-supplied env overrides ─────────────────────────────────────

if [ -f "${SCRIPT_DIR}/env" ]; then
    info "Loading ${SCRIPT_DIR}/env"
    # shellcheck disable=SC1091
    . "${SCRIPT_DIR}/env"
else
    warn "${SCRIPT_DIR}/env not found — using defaults from env.sample"
    # shellcheck disable=SC1091
    . "${SCRIPT_DIR}/env.sample"
fi

: "${EXT_IF:=vtnet0}"
: "${BRIDGE_NAME:=cbsd0}"
: "${CBSD_WORKDIR:=/usr/jails}"

# ── Preflight ────────────────────────────────────────────────────────────────

[ "$(id -u)" -eq 0 ] || die "must run as root"
command -v cbsd >/dev/null 2>&1 || die "cbsd not installed"

# ── Provision existing jails ────────────────────────────────────────────────

info "Provisioning existing jails"

POST_CREATE_DIR="${SCRIPT_DIR}/post-create"

# Check which jails exist and provision them
for jail in rmpca-extract rmpca-backend rmpca-redis rmpca-optimizer rmpca-celery rmpca-nginx-opt rmpca-moonshine; do
    if cbsd jls 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' | grep -w "^${jail}" >/dev/null 2>&1; then
        info "Provisioning: ${jail}"
        if [ -f "${POST_CREATE_DIR}/${jail}.sh" ]; then
            sh "${POST_CREATE_DIR}/${jail}.sh"
        else
            warn "No provisioning script found for ${jail}"
        fi
    else
        info "${jail} not found — skipping"
    fi
done

# ── Deploy application code ──────────────────────────────────────────────────

info "Running cbsd/deploy-existing.sh${DEPLOY_ARGS}"
# shellcheck disable=SC2086
sh "${SCRIPT_DIR}/deploy-existing.sh" ${DEPLOY_ARGS}

# ── Follow-up instructions ───────────────────────────────────────────────────

cat <<EOF

────────────────────────────────────────────────────────────────────────────────
✓ Existing jail provisioning complete.

Next steps:

  1. Verify services:
       cbsd jls
       sh ${SCRIPT_DIR}/cli/rmpca status --health

  2. Check logs if needed:
       sh ${SCRIPT_DIR}/cli/rmpca logs backend

  3. Redeploy after code changes:
       sh ${SCRIPT_DIR}/deploy.sh --all
────────────────────────────────────────────────────────────────────────────────
EOF
