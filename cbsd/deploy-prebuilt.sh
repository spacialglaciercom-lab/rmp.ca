#!/bin/sh
# deploy-prebuilt.sh — Pre-built artifact deployment for CBSD jails
# Implements Option 3: Build → Verify → Deploy workflow

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

# Get jail IP addresses from existing jails
get_jail_ip() {
    local jail="$1"
    cbsd jls | sed 's/\x1b\[[0-9;]*m//g' | grep -w "^${jail}" | awk '{print $3}' | cut -d'/' -f1
}

# Atomic rsync deployment
atomic_rsync() {
    local jail="$1" src="$2" dst="$3"
    
    # Create temporary directory
    temp_dir="/tmp/deploy-$$"
    rm -rf "${temp_dir}"
    mkdir -p "${temp_dir}"
    
    # Copy from source to temp
    info "Preparing artifact for ${jail}..."
    rsync -a "${src}/" "${temp_dir}/"
    
    # Verify temp directory
    if [ ! -d "${temp_dir}" ]; then
        die "Failed to create deployment artifact"
    fi
    
    # Deploy to jail
    info "Deploying to ${jail}..."
    cbsd jexec jname="${jail}" mkdir -p "${dst}"
    rsync -a --delete "${temp_dir}/" "${REPO_ROOT}/jail-mounts/${jail}${dst}/"
    
    # Clean up
    rm -rf "${temp_dir}"
}

# ── 1. Build & Verify Phase (Host) ────────────────────────────────────────

info "=== BUILD & VERIFY PHASE (Host) ==="

# Build extract service
if [ -d "${REPO_ROOT}/extract" ]; then
    info "Building extract service..."
    cd "${REPO_ROOT}/extract"
    if [ ! -d "node_modules" ]; then
        npm install --omit=dev
    fi
    # Note: No build step needed for extract service
else
    warn "Extract service not found — skipping"
fi

# Build backend service
if [ -d "${REPO_ROOT}" ]; then
    info "Building backend service..."
    cd "${REPO_ROOT}"
    if [ ! -f "node_modules/.bin/pnpm" ]; then
        npm install -g pnpm@10.0.0
        pnpm install --no-frozen-lockfile --ignore-scripts
        pnpm rebuild esbuild
        pnpm run build:server
        pnpm install --no-frozen-lockfile --prod --ignore-scripts
    fi
else
    warn "Backend service not found — skipping"
fi

# Build optimizer service
if [ "${OPTIMIZER}" -eq 1 ] && [ -d "${REPO_ROOT}/optimizer" ]; then
    info "Building optimizer service..."
    cd "${REPO_ROOT}/optimizer"
    if [ ! -d "venv" ]; then
        python -m venv venv
        source venv/bin/activate
        pip install -r requirements.txt
    fi
else
    warn "Optimizer service not found or disabled — skipping"
fi

# Build moonshine service
if [ "${MOONSHINE}" -eq 1 ] && [ -d "${REPO_ROOT}/moonshine" ]; then
    info "Building moonshine service..."
    cd "${REPO_ROOT}/moonshine"
    if [ ! -d "node_modules" ]; then
        npm install --omit=dev
    fi
else
    warn "Moonshine service not found or disabled — skipping"
fi

info "✓ Build phase complete"

# ── 2. Deploy Phase (Jails) ──────────────────────────────────────────────

info "=== DEPLOY PHASE (Jails) ==="

# Create mount points if needed
mkdir -p "${REPO_ROOT}/jail-mounts/rmpca-extract/usr/local/app"
mkdir -p "${REPO_ROOT}/jail-mounts/rmpca-backend/usr/local/app"
mkdir -p "${REPO_ROOT}/jail-mounts/rmpca-optimizer/usr/local/app"
mkdir -p "${REPO_ROOT}/jail-mounts/rmpca-celery/usr/local/app"
mkdir -p "${REPO_ROOT}/jail-mounts/rmpca-moonshine/usr/local/app"

# Deploy extract service
if cbsd jls | sed 's/\x1b\[[0-9;]*m//g' | grep -w "^rmpca-extract" >/dev/null 2>&1; then
    info "Deploying rmpca-extract"
    atomic_rsync "rmpca-extract" "${REPO_ROOT}/extract" "/usr/local/app/extract"
    
    # Configure and start
    cbsd jexec jname=rmpca-extract sh -c "chown www:www /usr/local/app/extract 2>/dev/null || true"
    cbsd jexec jname=rmpca-extract service extract restart || cbsd jexec jname=rmpca-extract service extract start
else
    warn "rmpca-extract jail not found — skipping"
fi

# Deploy backend service
if cbsd jls | sed 's/\x1b\[[0-9;]*m//g' | grep -w "^rmpca-backend" >/dev/null 2>&1; then
    info "Deploying rmpca-backend"
    atomic_rsync "rmpca-backend" "${REPO_ROOT}" "/usr/local/app"
    
    # Configure inter-service communication
    EXTRACT_IP=$(get_jail_ip "rmpca-extract")
    OPTIMIZER_URL=""
    
    if [ "${OPTIMIZER}" -eq 1 ] && cbsd jls | sed 's/\x1b\[[0-9;]*m//g' | grep -w "^rmpca-nginx-opt" >/dev/null 2>&1; then
        NGINX_OPT_IP=$(get_jail_ip "rmpca-nginx-opt")
        OPTIMIZER_URL="OPTIMIZER_BACKEND_URL=http://${NGINX_OPT_IP}:80"
    fi

    cbsd jexec jname=rmpca-backend sh -c "cat > /usr/local/etc/rmpca/backend.env <<ENV
NODE_ENV=production
PORT=3000
EXTRACT_WS_UPSTREAM=http://${EXTRACT_IP}:9000
${OPTIMIZER_URL}
ENV"

    # Copy secrets
    if [ -f "${REPO_ROOT}/.env.server" ]; then
        cbsd jexec jname=rmpca-backend sh -c "cat >> /usr/local/etc/rmpca/backend.env" < "${REPO_ROOT}/.env.server"
    fi
    
    cbsd jexec jname=rmpca-backend sh -c "chown www:www /usr/local/app 2>/dev/null || true"
    cbsd jexec jname=rmpca-backend service backend restart || cbsd jexec jname=rmpca-backend service backend start
else
    warn "rmpca-backend jail not found — skipping"
fi

# Deploy redis (no code, just service)
if cbsd jls | sed 's/\x1b\[[0-9;]*m//g' | grep -w "^rmpca-redis" >/dev/null 2>&1; then
    info "Ensuring rmpca-redis is running"
    cbsd jexec jname=rmpca-redis service redis restart || cbsd jexec jname=rmpca-redis service redis start
else
    warn "rmpca-redis jail not found — skipping"
fi

# Deploy optimizer (optional)
if [ "${OPTIMIZER}" -eq 1 ]; then
    if cbsd jls | sed 's/\x1b\[[0-9;]*m//g' | grep -w "^rmpca-optimizer" >/dev/null 2>&1; then
        info "Deploying rmpca-optimizer"
        atomic_rsync "rmpca-optimizer" "${REPO_ROOT}/optimizer" "/usr/local/app/optimizer"
        
        # Configure
        REDIS_IP=$(get_jail_ip "rmpca-redis")
        cbsd jexec jname=rmpca-optimizer sh -c "cat > /usr/local/etc/rmpca/optimizer.env <<ENV
REDIS_URL=redis://${REDIS_IP}:6379/0
PORT=8000
ENV"
        
        cbsd jexec jname=rmpca-optimizer sh -c "chown www:www /usr/local/app/optimizer 2>/dev/null || true"
        cbsd jexec jname=rmpca-optimizer service optimizer restart || cbsd jexec jname=rmpca-optimizer service optimizer start
    else
        warn "rmpca-optimizer jail not found — skipping"
    fi
    
    # Deploy celery
    if cbsd jls | sed 's/\x1b\[[0-9;]*m//g' | grep -w "^rmpca-celery" >/dev/null 2>&1; then
        info "Deploying rmpca-celery"
        atomic_rsync "rmpca-celery" "${REPO_ROOT}/celery" "/usr/local/app/celery"
        
        # Configure
        REDIS_IP=$(get_jail_ip "rmpca-redis")
        cbsd jexec jname=rmpca-celery sh -c "cat > /usr/local/etc/rmpca/celery.env <<ENV
REDIS_URL=redis://${REDIS_IP}:6379/0
ENV"
        
        cbsd jexec jname=rmpca-celery sh -c "chown www:www /usr/local/app/celery 2>/dev/null || true"
        cbsd jexec jname=rmpca-celery service celery restart || cbsd jexec jname=rmpca-celery service celery start
    else
        warn "rmpca-celery jail not found — skipping"
    fi
    
    # Deploy nginx-optimizer
    if cbsd jls | sed 's/\x1b\[[0-9;]*m//g' | grep -w "^rmpca-nginx-opt" >/dev/null 2>&1; then
        info "Deploying rmpca-nginx-opt"
        cbsd jexec jname=rmpca-nginx-opt mkdir -p /usr/local/etc/nginx
        cbsd jailscp "${REPO_ROOT}/cbsd/files/nginx-opt/usr/local/etc/nginx/nginx.conf" rmpca-nginx-opt:/usr/local/etc/nginx/nginx.conf
        
        # Configure
        OPTIMIZER_IP=$(get_jail_ip "rmpca-optimizer")
        cbsd jexec jname=rmpca-nginx-opt sh -c "
            sed -i '' 's|proxy_pass http://127.0.0.1:8000|proxy_pass http://${OPTIMIZER_IP}:8000|' /usr/local/etc/nginx/nginx.conf
        "
        
        cbsd jexec jname=rmpca-nginx-opt service nginx restart || cbsd jexec jname=rmpca-nginx-opt service nginx start
    else
        warn "rmpca-nginx-opt jail not found — skipping"
    fi
fi

# Deploy moonshine (optional)
if [ "${MOONSHINE}" -eq 1 ]; then
    if cbsd jls | sed 's/\x1b\[[0-9;]*m//g' | grep -w "^rmpca-moonshine" >/dev/null 2>&1; then
        info "Deploying rmpca-moonshine"
        atomic_rsync "rmpca-moonshine" "${REPO_ROOT}/moonshine" "/usr/local/app/moonshine"
        
        cbsd jexec jname=rmpca-moonshine sh -c "chown www:www /usr/local/app/moonshine 2>/dev/null || true"
        cbsd jexec jname=rmpca-moonshine service moonshine restart || cbsd jexec jname=rmpca-moonshine service moonshine start
    else
        warn "rmpca-moonshine jail not found — skipping"
    fi
fi

info "✓ Pre-built deployment complete"
info "Next: Run formal verification with: cd .vibe/skills/lean-verify && sh verify.sh"
