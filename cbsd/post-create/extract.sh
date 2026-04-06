#!/bin/sh
# Post-create provisioning for rmpca-extract jail.
# Replaces bastille/extract/Bastillefile.
#
# Installs packages, copies service files, enables the rc.d service.

set -e

JAIL="rmpca-extract"
FILES_DIR="$(cd "$(dirname "$0")/../files/extract" && pwd)"

info()  { printf '\033[1;34m==> [%s] %s\033[0m\n' "$JAIL" "$*"; }

info "Installing packages"
cbsd jexec jname=${JAIL} pkg install -y node20 npm-node20 python3 gmake

info "Creating directories"
cbsd jexec jname=${JAIL} mkdir -p /app/extract /usr/local/etc/rmpca

info "Copying service files"
cbsd jailscp ${FILES_DIR}/usr/local/libexec/rmpca-extract ${JAIL}:/usr/local/libexec/rmpca-extract
cbsd jailscp ${FILES_DIR}/usr/local/etc/rc.d/extract ${JAIL}:/usr/local/etc/rc.d/extract
cbsd jailscp ${FILES_DIR}/usr/local/etc/rmpca/extract.env ${JAIL}:/usr/local/etc/rmpca/extract.env

info "Setting permissions"
cbsd jexec jname=${JAIL} chmod 755 /usr/local/libexec/rmpca-extract
cbsd jexec jname=${JAIL} chmod 755 /usr/local/etc/rc.d/extract

info "Enabling service"
cbsd jexec jname=${JAIL} sysrc extract_enable=YES

info "Post-create complete"
