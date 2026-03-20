# Start Expo + tRPC dev server (uses pnpm if available, else npm)
Set-Location $PSScriptRoot\..
$nodePaths = @("$env:APPDATA\npm", "${env:ProgramFiles}\nodejs") | Where-Object { $_ -and (Test-Path $_) }
if ($nodePaths.Count -gt 0) { $env:Path = ($nodePaths + $env:Path) -join ";" }
Write-Host "Starting trashroute-mobile (Expo + tRPC server)..." -ForegroundColor Cyan
if (Get-Command pnpm -ErrorAction SilentlyContinue) { pnpm dev } else { npm run dev }
