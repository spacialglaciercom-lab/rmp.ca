#!/bin/sh
# deploy-existing.sh — Copy application source into EXISTING jails.
#
# Modified version that works with existing jail IPs (10.0.0.x network).
#
# Run from the repository root:
#   sudo ./cbsd/deploy-existing.sh
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
warn()  { printf '\033[1;33mWARN: %s\033[0m\n' "$*" >&2; }
die()   { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

require_root() { [ "$(id -u)" -eq 0 ] || die "Must be run as root"; }
require_root

jail_cp_dir() {
    local jail="$1" src="$2" dst="$3"
    cbsd jexec jname="${jail}" mkdir -p "${dst}"
    tar -C "${src}" -cf - . | cbsd jexec jname="${jail}" tar -C "${dst}" -xf -
}

# Get jail IP addresses from existing jails
get_jail_ip() {
    local jail="$1"
    cbsd jls | sed 's/\x1b\[[0-9;]*m//g' | grep -w "^${jail}" | awk '{print $3}' | cut -d'/' -f1
}

# ── 1. Extract service ──────────────────────────────────────────────────────

if cbsd jls | sed 's/\x1b\[[0-9;]*m//g' | grep -w "^rmpca-extract" >/dev/null 2>&1; then
    info "Deploying rmpca-extract"
    cbsd jexec jname=rmpca-extract mkdir -p /usr/local/app/extract
    jail_cp_dir rmpca-extract "${REPO_ROOT}/extract" /usr/local/app/extract
    cbsd jexec jname=rmpca-extract sh -c "cd /usr/local/app/extract && npm install --omit=dev"
    cbsd jexec jname=rmpca-extract sh -c "chown -R www:www /usr/local/app/extract"
    cbsd jexec jname=rmpca-extract service extract restart || cbsd jexec jname=rmpca-extract service extract start
else
    warn "rmpca-extract jail not found — skipping"
fi

# ── 2. Node.js API server (backend) ────────────────────────────────────────

if cbsd jls | sed 's/\x1b\[[0-9;]*m//g' | grep -w "^rmpca-backend" >/dev/null 2>&1; then
    info "Deploying rmpca-backend"
    cbsd jexec jname=rmpca-backend mkdir -p /usr/local/app
    jail_cp_dir rmpca-backend "${REPO_ROOT}" /usr/local/app

    cbsd jexec jname=rmpca-backend sh -c "
        cd /usr/local/app
        npm install -g pnpm@10.0.0
        pnpm install --no-frozen-lockfile --ignore-scripts
        pnpm rebuild esbuild
        pnpm run build:server
        pnpm install --no-frozen-lockfile --prod --ignore-scripts
        chown -R www:www /usr/local/app
    "

    # Write backend.env with correct inter-jail addresses (using existing jail IPs)
    EXTRACT_IP=$(get_jail_ip "rmpca-extract")
    OPTIMIZER_URL=""
    
    if [ "${OPTIMIZER}" -eq 1 ] && cbsd jls | grep -qw "^rmpca-nginx-opt"; then
        NGINX_OPT_IP=$(get_jail_ip "rmpca-nginx-opt")
        OPTIMIZER_URL="OPTIMIZER_BACKEND_URL=http://${NGINX_OPT_IP}:80"
    fi

    cbsd jexec jname=rmpca-backend sh -c "cat > /usr/local/etc/rmpca/backend.env <<ENV
NODE_ENV=production
PORT=3000
EXTRACT_WS_UPSTREAM=http://${EXTRACT_IP}:9000
${OPTIMIZER_URL}
ENV"

    # Copy secrets from host .env.server if present
    if [ -f "${REPO_ROOT}/.env.server" ]; then
        info "Copying .env.server secrets into backend jail"
        cbsd jexec jname=rmpca-backend sh -c "cat >> /usr/local/etc/rmpca/backend.env" \
            < "${REPO_ROOT}/.env.server"
    fi
    
    cbsd jexec jname=rmpca-backend service backend restart || cbsd jexec jname=rmpca-backend service backend start
else
    warn "rmpca-backend jail not found — skipping"
fi

# ── 3. Redis ────────────────────────────────────────────────────────────────

if cbsd jls | sed 's/\x1b\[[0-9;]*m//g' | grep -w "^rmpca-redis" >/dev/null 2>&1; then
    info "Deploying rmpca-redis"
    # Redis doesn't need code deployment, just ensure it's running
    cbsd jexec jname=rmpca-redis service redis restart || cbsd jexec jname=rmpca-redis service redis start
else
    warn "rmpca-redis jail not found — skipping"
fi

# ── 4. Optimizer (optional) ─────────────────────────────────────────────────

if [ "${OPTIMIZER}" -eq 1 ]; then
    if cbsd jls | sed 's/\x1b\[[0-9;]*m//g' | grep -w "^rmpca-optimizer" >/dev/null 2>&1; then
        info "Deploying rmpca-optimizer"
        cbsd jexec jname=rmpca-optimizer mkdir -p /usr/local/app/optimizer
        jail_cp_dir rmpca-optimizer "${REPO_ROOT}/optimizer" /usr/local/app/optimizer
        cbsd jexec jname=rmpca-optimizer sh -c "cd /usr/local/app/optimizer && pip install -r requirements.txt"
        cbsd jexec jname=rmpca-optimizer sh -c "chown -R www:www /usr/local/app/optimizer"
        
        # Configure optimizer to talk to existing redis
        REDIS_IP=$(get_jail_ip "rmpca-redis")
        cbsd jexec jname=rmpca-optimizer sh -c "cat > /usr/local/etc/rmpca/optimizer.env <<ENV
REDIS_URL=redis://${REDIS_IP}:6379/0
PORT=8000
ENV"
        
        cbsd jexec jname=rmpca-optimizer service optimizer restart || cbsd jexec jname=rmpca-optimizer service optimizer start
    else
        warn "rmpca-optimizer jail not found — skipping"
    fi
    
    if cbsd jls | sed 's/\x1b\[[0-9;]*m//g' | grep -w "^rmpca-celery" >/dev/null 2>&1; then
        info "Deploying rmpca-celery"
        cbsd jexec jname=rmpca-celery mkdir -p /usr/local/app/celery
        jail_cp_dir rmpca-celery "${REPO_ROOT}/celery" /usr/local/app/celery
        cbsd jexec jname=rmpca-celery sh -c "cd /usr/local/app/celery && pip install -r requirements.txt"
        cbsd jexec jname=rmpca-celery sh -c "chown -R www:www /usr/local/app/celery"
        
        # Configure celery to talk to existing redis
        REDIS_IP=$(get_jail_ip "rmpca-redis")
        cbsd jexec jname=rmpca-celery sh -c "cat > /usr/local/etc/rmpca/celery.env <<ENV
REDIS_URL=redis://${REDIS_IP}:6379/0
ENV"
        
        cbsd jexec jname=rmpca-celery service celery restart || cbsd jexec jname=rmpca-celery service celery start
    else
        warn "rmpca-celery jail not found — skipping"
    fi
    
    if cbsd jls | sed 's/\x1b\[[0-9;]*m//g' | grep -w "^rmpca-nginx-opt" >/dev/null 2>&1; then
        info "Deploying rmpca-nginx-opt"
        cbsd jexec jname=rmpca-nginx-opt mkdir -p /usr/local/etc/nginx
        cbsd jailscp "${REPO_ROOT}/cbsd/files/nginx-opt/usr/local/etc/nginx/nginx.conf" rmpca-nginx-opt:/usr/local/etc/nginx/nginx.conf
        
        # Configure nginx to proxy to optimizer
        OPTIMIZER_IP=$(get_jail_ip "rmpca-optimizer")
        cbsd jexec jname=rmpca-nginx-opt sh -c "
            sed -i '' 's|proxy_pass http://127.0.0.1:8000|proxy_pass http://${OPTIMIZER_IP}:8000|' /usr/local/etc/nginx/nginx.conf
        "
        
        cbsd jexec jname=rmpca-nginx-opt service nginx restart || cbsd jexec jname=rmpca-nginx-opt service nginx start
    else
        warn "rmpca-nginx-opt jail not found — skipping"
    fi
fi

# ── 5. Moonshine (optional) ────────────────────────────────────────────────

if [ "${MOONSHINE}" -eq 1 ]; then
    if cbsd jls | sed 's/\x1b\[[0-9;]*m//g' | grep -w "^rmpca-moonshine" >/dev/null 2>&1; then
        info "Deploying rmpca-moonshine"
        cbsd jexec jname=rmpca-moonshine mkdir -p /usr/local/app/moonshine
        jail_cp_dir rmpca-moonshine "${REPO_ROOT}/moonshine" /usr/local/app/moonshine
        cbsd jexec jname=rmpca-moonshine sh -c "cd /usr/local/app/moonshine && npm install --omit=dev"
        cbsd jexec jname=rmpca-moonshine sh -c "chown -R www:www /usr/local/app/moonshine"
        cbsd jexec jname=rmpca-moonshine service moonshine restart || cbsd jexec jname=rmpca-moonshine service moonshine start
    else
        warn "rmpca-moonshine jail not found — skipping"
    fi
fi

info "Deployment complete!"
