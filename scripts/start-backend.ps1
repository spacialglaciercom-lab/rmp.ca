# Start trash-route MC-CARP API (port 8000)
# Set env TRASH_ROUTE_PATH to your backend folder if not in default locations, e.g.:
#   $env:TRASH_ROUTE_PATH = "C:\path\to\trash-route"
#   Or in System Properties > Environment Variables add TRASH_ROUTE_PATH

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$candidates = @()
if ($env:TRASH_ROUTE_PATH) {
    $candidates += $env:TRASH_ROUTE_PATH
}
$candidates += Join-Path $root "..\trash-route"   # sibling of trashroute-mobile
$candidates += Join-Path $PSScriptRoot "..\..\trash-route"
$candidates += Join-Path $env:USERPROFILE "trash-route"

$trashRoute = $null
foreach ($dir in $candidates) {
    $dir = [System.IO.Path]::GetFullPath($dir)
    if (Test-Path (Join-Path $dir "src\api_main.py")) {
        $trashRoute = $dir
        break
    }
}

if (-not $trashRoute) {
    Write-Host "trash-route API not found." -ForegroundColor Red
    Write-Host "Searched: $($candidates -join ', ')" -ForegroundColor Gray
    Write-Host "Set TRASH_ROUTE_PATH to your backend folder (e.g. where src\api_main.py is)." -ForegroundColor Yellow
    Write-Host "Expo + tRPC will keep running; only MC-CARP is skipped." -ForegroundColor Gray
    pause
    exit 1
}

Set-Location (Join-Path $trashRoute "src")
Write-Host "Starting trash-route MC-CARP API on http://localhost:8000..." -ForegroundColor Cyan
python -m uvicorn api_main:app --host 0.0.0.0 --port 8000 --reload
