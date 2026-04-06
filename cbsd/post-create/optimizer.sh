#!/bin/sh
# Post-create provisioning for rmpca-optimizer jail.
# Replaces bastille/optimizer/Bastillefile.

set -e

JAIL="rmpca-optimizer"
FILES_DIR="$(cd "$(dirname "$0")/../files/optimizer" && pwd)"

info()  { printf '\033[1;34m==> [%s] %s\033[0m\n' "$JAIL" "$*"; }

info "Installing packages"
cbsd jexec jname=${JAIL} pkg install -y python312 py312-pip py312-virtualenv

info "Creating directories"
cbsd jexec jname=${JAIL} mkdir -p /app/backend /usr/local/etc/rmpca

info "Creating virtualenv"
cbsd jexec jname=${JAIL} python3.12 -m venv /app/backend/venv

info "Copying service files"
cbsd jailscp ${FILES_DIR}/usr/local/libexec/rmpca-optimizer ${JAIL}:/usr/local/libexec/rmpca-optimizer
cbsd jailscp ${FILES_DIR}/usr/local/etc/rc.d/optimizer ${JAIL}:/usr/local/etc/rc.d/optimizer
cbsd jailscp ${FILES_DIR}/usr/local/etc/rmpca/optimizer.env ${JAIL}:/usr/local/etc/rmpca/optimizer.env

info "Setting permissions"
cbsd jexec jname=${JAIL} chmod 755 /usr/local/libexec/rmpca-optimizer
cbsd jexec jname=${JAIL} chmod 755 /usr/local/etc/rc.d/optimizer

info "Enabling service"
cbsd jexec jname=${JAIL} sysrc optimizer_enable=YES

info "Post-create complete"
