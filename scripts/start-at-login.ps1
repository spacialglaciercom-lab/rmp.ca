# Run at Windows login: starts trashroute-mobile stack (Expo + tRPC + MC-CARP).
# Use install-startup.ps1 to add this to Startup, or put a shortcut in Startup yourself.

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

# Short delay so PATH and profile are ready when run at logon
Start-Sleep -Seconds 3

# Start Expo + tRPC in a new window (minimized); start-dev.ps1 sets PATH so pnpm is found
$startDev = Join-Path $PSScriptRoot "start-dev.ps1"
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", $startDev -WindowStyle Minimized -WorkingDirectory $root

Start-Sleep -Seconds 2

# Start MC-CARP backend in a new window (minimized); skips cleanly if backend path not found
$startBackend = Join-Path $PSScriptRoot "start-backend.ps1"
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", $startBackend -WindowStyle Minimized -WorkingDirectory $root

# Optional: log that we ran (remove if you don't want the file)
# "$(Get-Date -Format o) Started trashroute-mobile at login" | Out-File -Append (Join-Path $root "scripts\start-at-login.log")
