# Run pnpm dev with PATH set so Node/pnpm are found (e.g. when run from Startup or cmd).
# Call this from start-all / start-at-login so Expo + tRPC starts even if PATH is minimal.

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $root

# Prepend common Node/npm/pnpm locations so pnpm is found when run from Startup or fresh cmd
$nodePaths = @(
  "$env:APPDATA\npm",
  "${env:ProgramFiles}\nodejs",
  "${env:ProgramFiles(x86)}\nodejs"
) | Where-Object { $_ -and (Test-Path $_) }
if ($nodePaths.Count -gt 0) {
  $env:Path = ($nodePaths + $env:Path) -join ";"
}

$usePnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $usePnpm) {
  Write-Host "pnpm not found; using npm run dev." -ForegroundColor Yellow
}

Write-Host "Starting trashroute-mobile (Expo + tRPC server)..." -ForegroundColor Cyan
if ($usePnpm) { pnpm dev } else { npm run dev }
