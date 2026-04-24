#!/bin/sh
# Fix DNS for all jails
echo "nameserver 8.8.8.8" > /etc/resolv.conf
