# Start app + backend(s) - opens new terminals. Works when run from any folder (e.g. Startup).
# Ports 3000 (tRPC) and 19007 (Expo) are reserved for this project; we clear them first.
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $root
& (Join-Path $PSScriptRoot "kill-ports.ps1")

Write-Host "Starting trashroute-mobile stack..." -ForegroundColor Cyan
$startDev = Join-Path $PSScriptRoot "start-dev.ps1"
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", $startDev -WindowStyle Normal -WorkingDirectory $root
Start-Sleep -Seconds 2
$startBackend = Join-Path $PSScriptRoot "start-backend.ps1"
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", $startBackend -WindowStyle Normal -WorkingDirectory $root
Start-Sleep -Seconds 1
$routemasterPath1 = Join-Path $root "..\..\..\backend\trash-route-api"
$routemasterPath2 = Join-Path $root "..\trash-route-api"
$routemasterMain = "app\main.py"
$hasRoutemaster = (Test-Path (Join-Path $routemasterPath1 $routemasterMain)) -or (Test-Path (Join-Path $routemasterPath2 $routemasterMain))
if ($hasRoutemaster) {
  Start-Process cmd -ArgumentList "/k", "cd /d `"$PSScriptRoot`" && start-routemaster.bat" -WindowStyle Normal -WorkingDirectory $root
  Write-Host "`nLaunched: Expo + tRPC, MC-CARP, and RouteMaster." -ForegroundColor Green
} else {
  Write-Host "`nRouteMaster skipped (trash-route-api not found). Set BACKEND_PATH in start-routemaster.bat if you have it elsewhere." -ForegroundColor Yellow
  Write-Host "Launched: Expo + tRPC and MC-CARP." -ForegroundColor Green
}
Write-Host "MC-CARP runs only if TRASH_ROUTE_PATH is set or trash-route is in a default location."
Write-Host "Close the spawned windows to stop."
