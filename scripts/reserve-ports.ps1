# OPTIONAL: Reserve ports 3000 and 19007 for trashroute-mobile only (Windows).
# Excludes them from dynamic port allocation so other apps won't use them.
# Requires: Run PowerShell as Administrator.

$ports = @(3000, 19007)
foreach ($port in $ports) {
  netsh int ipv4 add excludedportrange protocol=tcp startport=$port numberofports=1
  if ($LASTEXITCODE -eq 0) { Write-Host "Reserved TCP port $port for trashroute-mobile." -ForegroundColor Green }
  else { Write-Host "Could not reserve $port (maybe already excluded or need Admin)." -ForegroundColor Yellow }
}
Write-Host "To remove reservation later (Admin): netsh int ipv4 delete excludedportrange protocol=tcp startport=3000 numberofports=1" -ForegroundColor Gray
