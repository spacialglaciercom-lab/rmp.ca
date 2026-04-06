#!/bin/sh
# Post-create provisioning for rmpca-backend jail.
# Replaces bastille/backend/Bastillefile.

set -e

JAIL="rmpca-backend"
FILES_DIR="$(cd "$(dirname "$0")/../files/backend" && pwd)"

info()  { printf '\033[1;34m==> [%s] %s\033[0m\n' "$JAIL" "$*"; }

info "Installing packages"
cbsd jexec jname=${JAIL} pkg install -y node20 npm-node20

info "Installing pnpm globally"
cbsd jexec jname=${JAIL} npm install -g pnpm@10.0.0

info "Creating directories"
cbsd jexec jname=${JAIL} mkdir -p /app/dist /app/patches /app/shared-logic/pnpm-stub /usr/local/etc/rmpca

info "Copying service files"
cbsd jailscp ${FILES_DIR}/usr/local/libexec/rmpca-backend ${JAIL}:/usr/local/libexec/rmpca-backend
cbsd jailscp ${FILES_DIR}/usr/local/etc/rc.d/backend ${JAIL}:/usr/local/etc/rc.d/backend
cbsd jailscp ${FILES_DIR}/usr/local/etc/rmpca/backend.env ${JAIL}:/usr/local/etc/rmpca/backend.env

info "Setting permissions"
cbsd jexec jname=${JAIL} chmod 755 /usr/local/libexec/rmpca-backend
cbsd jexec jname=${JAIL} chmod 755 /usr/local/etc/rc.d/backend

info "Enabling service"
cbsd jexec jname=${JAIL} sysrc backend_enable=YES

info "Post-create complete"
