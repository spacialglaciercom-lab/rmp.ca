#!/bin/sh
# deploy.sh — Copy application source into jails, install deps, restart services.
#
# Run from the repository root after bootstrap.sh has finished:
#   sudo ./cbsd/deploy.sh
#
# Re-running is safe (idempotent): it overwrites code, reinstalls deps,
# and restarts services.  Redis data is not touched.
#
# Flags:
#   --optimizer   Also deploy optimizer + celery + nginx-optimizer jails.
#   --moonshine   Also deploy the moonshine ASR sidecar jail.
#   --all         Deploy everything.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OPTIMIZER=0
MOONSHINE=0

for arg in "$@"; do
    case "$arg" in
        --optimizer) OPTIMIZER=1 ;;
        --moonshine) MOONSHINE=1 ;;
        --all)       OPTIMIZER=1; MOONSHINE=1 ;;
    esac
done

# ── Helpers ──────────────────────────────────────────────────────────────────

info()  { printf '\033[1;34m==> %s\033[0m\n' "$*"; }
die()   { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

require_root() { [ "$(id -u)" -eq 0 ] || die "Must be run as root"; }
require_root

jail_cp_dir() {
    local jail="$1" src="$2" dst="$3"
    cbsd jexec jname="${jail}" mkdir -p "${dst}"
    tar -C "${src}" -cf - . | cbsd jexec jname="${jail}" sh -c "tar -C ${dst} -xf -"
}

# ── 1. Extract service ────────────────────────────────────────────────────────

info "Deploying rmpca-extract"
cbsd jexec jname=rmpca-extract mkdir -p /app/extract
jail_cp_dir rmpca-extract "${REPO_ROOT}/extract" /app/extract
cbsd jexec jname=rmpca-extract sh -c "cd /app/extract && npm install --omit=dev"
cbsd jexec jname=rmpca-extract sh -c "chown -R www:www /app/extract"
cbsd jexec jname=rmpca-extract service extract restart || cbsd jexec jname=rmpca-extract service extract start

# ── 2. Node.js API server (backend) ──────────────────────────────────────────

info "Deploying rmpca-backend"
cbsd jexec jname=rmpca-backend mkdir -p /app
jail_cp_dir rmpca-backend "${REPO_ROOT}" /app

cbsd jexec jname=rmpca-backend sh -c "
    cd /app
    npm install -g pnpm@10.0.0
    pnpm install --no-frozen-lockfile --ignore-scripts
    pnpm rebuild esbuild
    pnpm run build:server
    pnpm install --no-frozen-lockfile --prod --ignore-scripts
    chown -R www:www /app
"

# Write backend.env with correct inter-jail addresses
cbsd jexec jname=rmpca-backend sh -c "cat > /usr/local/etc/rmpca/backend.env <<'ENV'
NODE_ENV=production
PORT=3000
EXTRACT_WS_UPSTREAM=http://10.10.0.2:4000
$([ "${OPTIMIZER}" -eq 1 ] && echo 'OPTIMIZER_BACKEND_URL=http://10.10.0.7:80' || true)
ENV"

# Copy secrets from host .env.server if present
if [ -f "${REPO_ROOT}/.env.server" ]; then
    info "Copying .env.server secrets into backend jail"
    cbsd jexec jname=rmpca-backend sh -c "cat >> /usr/local/etc/rmpca/backend.env" \
        < "${REPO_ROOT}/.env.server"
fi

cbsd jexec jname=rmpca-backend service backend restart || cbsd jexec jname=rmpca-backend service backend start

# ── 3. Optimizer stack (optional) ────────────────────────────────────────────

if [ "${OPTIMIZER}" -eq 1 ]; then

    info "Deploying rmpca-redis (config only — data preserved)"
    sh "$(dirname "$0")/post-create/redis.sh"
    cbsd jexec jname=rmpca-redis service redis restart || cbsd jexec jname=rmpca-redis service redis start

    for jail in rmpca-optimizer rmpca-celery; do
        info "Deploying ${jail}"
        cbsd jexec jname="${jail}" mkdir -p /app/backend
        jail_cp_dir "${jail}" "${REPO_ROOT}/backend" /app/backend
        cbsd jexec jname="${jail}" sh -c "
            /app/backend/venv/bin/pip install --no-cache-dir -r /app/backend/requirements.txt
            chown -R www:www /app/backend
        "
    done

    # optimizer.env — REDIS_URL points to redis jail
    cbsd jexec jname=rmpca-optimizer sh -c "cat > /usr/local/etc/rmpca/optimizer.env <<'ENV'
PORT=8000
REDIS_URL=redis://10.10.0.4:6379/0
ENV"

    # celery.env
    cbsd jexec jname=rmpca-celery sh -c "cat > /usr/local/etc/rmpca/celery.env <<'ENV'
REDIS_URL=redis://10.10.0.4:6379/0
$([ -n "${DEM_PATH:-}" ] && echo "DEM_PATH=${DEM_PATH}" || true)
ENV"

    cbsd jexec jname=rmpca-optimizer service optimizer restart || cbsd jexec jname=rmpca-optimizer service optimizer start
    cbsd jexec jname=rmpca-celery     service celery    restart || cbsd jexec jname=rmpca-celery     service celery    start

    info "Wiring optimizer hostname in nginx jail"
    cbsd jexec jname=rmpca-nginx-opt sh -c \
        "grep -q '^10.10.0.5' /etc/hosts || echo '10.10.0.5 optimizer' >> /etc/hosts"
    cbsd jexec jname=rmpca-nginx-opt service nginx restart || cbsd jexec jname=rmpca-nginx-opt service nginx start

fi

# ── 4. Moonshine ASR sidecar (optional) ──────────────────────────────────────

if [ "${MOONSHINE}" -eq 1 ]; then

    info "Deploying rmpca-moonshine"
    cbsd jexec jname=rmpca-moonshine mkdir -p /app/moonshine
    jail_cp_dir rmpca-moonshine "${REPO_ROOT}/server/moonshine-sidecar" /app/moonshine
    cbsd jexec jname=rmpca-moonshine sh -c "
        /app/moonshine/venv/bin/pip install --no-cache-dir -r /app/moonshine/requirements.txt
        chown -R www:www /app/moonshine
    "

    info "Pre-downloading Moonshine English model (may take a few minutes)"
    cbsd jexec jname=rmpca-moonshine sh -c \
        "cd /app/moonshine && /app/moonshine/venv/bin/python -c \
        'from moonshine_voice import get_model_for_language; get_model_for_language(\"en\")'"

    cbsd jexec jname=rmpca-moonshine service moonshine restart || cbsd jexec jname=rmpca-moonshine service moonshine start

fi

info "Deploy complete."
info "Service status:"
for jail in rmpca-extract rmpca-backend; do
    cbsd jexec jname="${jail}" service "$(echo "${jail}" | sed 's/rmpca-//')" status 2>/dev/null || true
done
[ "${OPTIMIZER}" -eq 1 ] && for jail in rmpca-redis rmpca-optimizer rmpca-celery rmpca-nginx-opt; do
    svc="$(echo "${jail}" | sed 's/rmpca-//' | sed 's/-opt//')"
    cbsd jexec jname="${jail}" service "${svc}" status 2>/dev/null || true
done
[ "${MOONSHINE}" -eq 1 ] && cbsd jexec jname=rmpca-moonshine service moonshine status 2>/dev/null || true
