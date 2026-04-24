#!/bin/sh
# Bastille Jails Backup Script
# Creates compressed backups of all Bastille jails

BACKUP_DIR="/root/jail_backups"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p "${BACKUP_DIR}"
echo "Creating backups in ${BACKUP_DIR}"

# Backup each jail
for jail in rmpcaextract rmpcabackend rmpcaredis rmpcaoptimizer rmpcacelery rmpcanginxopt rmpcamoonshine; do
  echo "Backing up ${jail}..."
  
  # Method 1: Using bastille export (preferred)
  if command -v bastille >/dev/null 2>&1; then
    bastille export "${jail}" "${BACKUP_DIR}/${jail}_${DATE}.tar.gz"
  else
    # Method 2: Direct tar backup
    tar -czf "${BACKUP_DIR}/${jail}_${DATE}.tar.gz" -C /usr/local/bastille/jails/${jail}/root .
  fi
  
  echo "✅ ${jail} backed up successfully"
done

echo ""
echo "Backup completed! Files are in: ${BACKUP_DIR}"
echo ""
echo "To transfer via SSH:"
echo "  scp /root/jail_backups/* user@remote_host:/backup/destination/"
