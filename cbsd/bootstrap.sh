#!/bin/sh
# bootstrap.sh — Create and configure all rmp.ca FreeBSD jails with CBSD.
#
# Run once on a fresh FreeBSD host as root.  After this script completes,
# run deploy.sh to push application code into the jails.
#
# Prerequisites:
#   pkg install cbsd
#   env workdir="/usr/jails" /usr/local/cbsd/sudoexec/initenv
#
# Network layout (VNET, 10.10.0.0/24):
#   rmpca-extract       10.10.0.2   port 4000 → host :4000
#   rmpca-backend       10.10.0.3   port 3000 → host :3000
#   rmpca-redis         10.10.0.4   (internal only)
#   rmpca-optimizer     10.10.0.5   (internal only)
#   rmpca-celery        10.10.0.6   (internal only)
#   rmpca-nginx-opt     10.10.0.7   port 80   → host :8000
#   rmpca-moonshine     10.10.0.8   port 8090 → host :8090
#
# Host-side port forwarding is done via pf(4); see the pf.conf block below.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROFILES_DIR="${SCRIPT_DIR}/profiles"
POST_CREATE_DIR="${SCRIPT_DIR}/post-create"

# ── Helpers ──────────────────────────────────────────────────────────────────

info()  { printf '\033[1;34m==> %s\033[0m\n' "$*"; }
die()   { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

require_root() {
    [ "$(id -u)" -eq 0 ] || die "Must be run as root"
}

jail_exists() {
    cbsd jls 2>/dev/null | awk '{print $1}' | grep -qx "$1"
}

# ── Preflight ─────────────────────────────────────────────────────────────────

require_root

command -v cbsd >/dev/null 2>&1 || die "cbsd not found — run: pkg install cbsd"

info "Fetching FreeBSD 14.2 base"
cbsd repo action=get sources=base ver=14.2 || true   # idempotent

# ── Create jails ──────────────────────────────────────────────────────────────

create_jail() {
    local name="$1"
    if jail_exists "${name}"; then
        info "Jail ${name} already exists — skipping"
    else
        info "Creating jail ${name}"
        cbsd jcreate jconf="${PROFILES_DIR}/${name}.jconf"
    fi
}

create_jail rmpca-extract
create_jail rmpca-backend
create_jail rmpca-redis
create_jail rmpca-optimizer
create_jail rmpca-celery
create_jail rmpca-nginx-opt
create_jail rmpca-moonshine

# ── Start jails ───────────────────────────────────────────────────────────────

for jail in rmpca-extract rmpca-backend rmpca-redis \
            rmpca-optimizer rmpca-celery rmpca-nginx-opt rmpca-moonshine; do
    info "Starting ${jail}"
    cbsd jstart jname="${jail}" || true
done

# ── Run post-create provisioning scripts ─────────────────────────────────────

info "Provisioning: extract"
sh "${POST_CREATE_DIR}/extract.sh"

info "Provisioning: backend"
sh "${POST_CREATE_DIR}/backend.sh"

info "Provisioning: redis"
sh "${POST_CREATE_DIR}/redis.sh"

info "Provisioning: optimizer"
sh "${POST_CREATE_DIR}/optimizer.sh"

info "Provisioning: celery"
sh "${POST_CREATE_DIR}/celery.sh"

info "Provisioning: nginx-optimizer"
sh "${POST_CREATE_DIR}/nginx-optimizer.sh"

info "Provisioning: moonshine"
sh "${POST_CREATE_DIR}/moonshine.sh"

# ── /etc/hosts wiring inside nginx-optimizer jail ────────────────────────────
# Nginx resolves "optimizer" via /etc/hosts (no Docker DNS here).

info "Writing optimizer host entry into rmpca-nginx-opt"
cbsd jexec jname=rmpca-nginx-opt sh -c \
    "grep -q '^10.10.0.5' /etc/hosts || echo '10.10.0.5 optimizer' >> /etc/hosts"

# ── pf(4) port forwarding ─────────────────────────────────────────────────────
# Add these rules to /etc/pf.conf on the host.  We print them here rather than
# modifying pf.conf automatically to avoid clobbering existing firewall rules.

cat <<'PF'

────────────────────────────────────────────────────────────────────────────────
Add the following NAT/RDR rules to /etc/pf.conf on the HOST (adjust ext_if):

  ext_if = "vtnet0"   # change to your external interface

  # rmp.ca jail port forwarding
  rdr pass on $ext_if proto tcp to port 3000 -> 10.10.0.3 port 3000   # backend
  rdr pass on $ext_if proto tcp to port 4000 -> 10.10.0.2 port 4000   # extract
  rdr pass on $ext_if proto tcp to port 8000 -> 10.10.0.7 port 80     # nginx-optimizer
  rdr pass on $ext_if proto tcp to port 8090 -> 10.10.0.8 port 8090   # moonshine

Then reload: pfctl -f /etc/pf.conf
────────────────────────────────────────────────────────────────────────────────
PF

info "Bootstrap complete. Run deploy.sh to push application code."
