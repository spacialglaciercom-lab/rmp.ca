#!/bin/sh
# bootstrap.sh — Create and configure all rmp.ca FreeBSD jails with Bastille.
#
# Run once on a fresh FreeBSD host as root.  After this script completes,
# run deploy.sh to push application code into the jails.
#
# Prerequisites:
#   pkg install bastille
#   sysrc bastille_enable=YES
#   service bastille start   (or: bastille setup)
#
# Network layout (VNET, bastille0 bridge 10.10.0.0/24):
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

RELEASE="14.2-RELEASE"
BRIDGE="bastille0"
TEMPLATE_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Helpers ──────────────────────────────────────────────────────────────────

info()  { printf '\033[1;34m==> %s\033[0m\n' "$*"; }
die()   { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

require_root() {
    [ "$(id -u)" -eq 0 ] || die "Must be run as root"
}

jail_exists() {
    bastille list | awk '{print $1}' | grep -qx "$1"
}

# ── Preflight ─────────────────────────────────────────────────────────────────

require_root

command -v bastille >/dev/null 2>&1 || die "bastille not found — run: pkg install bastille"

info "Bootstrapping FreeBSD ${RELEASE}"
bastille bootstrap "${RELEASE}" update || true   # idempotent

# ── Create jails ──────────────────────────────────────────────────────────────

create_jail() {
    local name="$1" ip="$2"
    if jail_exists "${name}"; then
        info "Jail ${name} already exists — skipping"
    else
        info "Creating jail ${name} (${ip})"
        bastille create -V "${name}" "${RELEASE}" "${ip}/24" "${BRIDGE}"
    fi
}

create_jail rmpca-extract    10.10.0.2
create_jail rmpca-backend    10.10.0.3
create_jail rmpca-redis      10.10.0.4
create_jail rmpca-optimizer  10.10.0.5
create_jail rmpca-celery     10.10.0.6
create_jail rmpca-nginx-opt  10.10.0.7
create_jail rmpca-moonshine  10.10.0.8

# ── Start jails ───────────────────────────────────────────────────────────────

for jail in rmpca-extract rmpca-backend rmpca-redis \
            rmpca-optimizer rmpca-celery rmpca-nginx-opt rmpca-moonshine; do
    info "Starting ${jail}"
    bastille start "${jail}" || true
done

# ── Apply Bastille templates ──────────────────────────────────────────────────

info "Applying template: extract"
bastille template rmpca-extract "${TEMPLATE_DIR}/extract"

info "Applying template: backend"
bastille template rmpca-backend "${TEMPLATE_DIR}/backend"

info "Applying template: redis"
bastille template rmpca-redis "${TEMPLATE_DIR}/redis"

info "Applying template: optimizer"
bastille template rmpca-optimizer "${TEMPLATE_DIR}/optimizer"

info "Applying template: celery"
bastille template rmpca-celery "${TEMPLATE_DIR}/celery"

info "Applying template: nginx-optimizer"
bastille template rmpca-nginx-opt "${TEMPLATE_DIR}/nginx-optimizer"

info "Applying template: moonshine"
bastille template rmpca-moonshine "${TEMPLATE_DIR}/moonshine"

# ── /etc/hosts wiring inside nginx-optimizer jail ────────────────────────────
# Nginx resolves "optimizer" via /etc/hosts (no Docker DNS here).

info "Writing optimizer host entry into rmpca-nginx-opt"
bastille cmd rmpca-nginx-opt sh -c \
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
