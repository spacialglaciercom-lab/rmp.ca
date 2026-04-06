#!/bin/sh
# Post-create provisioning for rmpca-nginx-opt jail.
# Replaces bastille/nginx-optimizer/Bastillefile.

set -e

JAIL="rmpca-nginx-opt"
FILES_DIR="$(cd "$(dirname "$0")/../files/nginx-optimizer" && pwd)"

info()  { printf '\033[1;34m==> [%s] %s\033[0m\n' "$JAIL" "$*"; }

info "Installing packages"
cbsd jexec jname=${JAIL} pkg install -y nginx

info "Configuring nginx"
cbsd jexec jname=${JAIL} rm -f /usr/local/etc/nginx/nginx.conf
cbsd jexec jname=${JAIL} mkdir -p /usr/local/etc/nginx/conf.d

cbsd jailscp ${FILES_DIR}/usr/local/etc/nginx/conf.d/optimizer.conf \
    ${JAIL}:/usr/local/etc/nginx/conf.d/optimizer.conf

# Write minimal nginx.conf
cbsd jexec jname=${JAIL} sh -c "printf 'worker_processes auto;\nevents { worker_connections 1024; }\nhttp {\n    include       mime.types;\n    default_type  application/octet-stream;\n    sendfile on;\n    include /usr/local/etc/nginx/conf.d/*.conf;\n}\n' > /usr/local/etc/nginx/nginx.conf"

info "Enabling service"
cbsd jexec jname=${JAIL} sysrc nginx_enable=YES

info "Post-create complete"
