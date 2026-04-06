#!/bin/sh
# Post-create provisioning for rmpca-redis jail.
# Replaces bastille/redis/Bastillefile.

set -e

JAIL="rmpca-redis"
FILES_DIR="$(cd "$(dirname "$0")/../files/redis" && pwd)"

info()  { printf '\033[1;34m==> [%s] %s\033[0m\n' "$JAIL" "$*"; }

info "Installing packages"
cbsd jexec jname=${JAIL} pkg install -y redis

info "Copying config"
cbsd jailscp ${FILES_DIR}/usr/local/etc/redis.conf ${JAIL}:/usr/local/etc/redis.conf

info "Enabling and starting service"
cbsd jexec jname=${JAIL} sysrc redis_enable=YES
cbsd jexec jname=${JAIL} service redis start

info "Post-create complete"
