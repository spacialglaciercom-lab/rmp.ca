#!/bin/sh
# Post-create provisioning for rmpca-moonshine jail.
# Replaces bastille/moonshine/Bastillefile.

set -e

JAIL="rmpca-moonshine"
FILES_DIR="$(cd "$(dirname "$0")/../files/moonshine" && pwd)"

info()  { printf '\033[1;34m==> [%s] %s\033[0m\n' "$JAIL" "$*"; }

info "Installing packages"
cbsd jexec jname=${JAIL} pkg install -y python311 py311-pip py311-virtualenv ffmpeg

info "Creating directories"
cbsd jexec jname=${JAIL} mkdir -p /app/moonshine /usr/local/etc/rmpca

info "Creating virtualenv"
cbsd jexec jname=${JAIL} python3.11 -m venv /app/moonshine/venv

info "Copying service files"
cbsd jailscp ${FILES_DIR}/usr/local/libexec/rmpca-moonshine ${JAIL}:/usr/local/libexec/rmpca-moonshine
cbsd jailscp ${FILES_DIR}/usr/local/etc/rc.d/moonshine ${JAIL}:/usr/local/etc/rc.d/moonshine
cbsd jailscp ${FILES_DIR}/usr/local/etc/rmpca/moonshine.env ${JAIL}:/usr/local/etc/rmpca/moonshine.env

info "Setting permissions"
cbsd jexec jname=${JAIL} chmod 755 /usr/local/libexec/rmpca-moonshine
cbsd jexec jname=${JAIL} chmod 755 /usr/local/etc/rc.d/moonshine

info "Enabling service"
cbsd jexec jname=${JAIL} sysrc moonshine_enable=YES

info "Post-create complete"
