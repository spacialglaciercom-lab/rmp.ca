# Add trashroute-mobile to Windows Startup (run start-at-login.ps1 when you log in).
# Run this once: right-click install-startup.ps1 -> Run with PowerShell (or: powershell -ExecutionPolicy Bypass -File install-startup.ps1)

$ErrorActionPreference = "Stop"
$root = "C:\trashroute-mobile"
if (-not (Test-Path $root)) { $root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
$startAtLogin = Join-Path $root "scripts\start-at-login.ps1"

$startupFolder = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupFolder "trashroute-mobile.lnk"

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startAtLogin`""
$shortcut.WorkingDirectory = $root
$shortcut.Description = "Start trashroute-mobile (Expo + tRPC + MC-CARP) at login"
$shortcut.Save()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($wsh) | Out-Null

Write-Host "Added to Startup: $shortcutPath" -ForegroundColor Green
Write-Host "trashroute-mobile will start automatically when you log in." -ForegroundColor Cyan
Write-Host "To remove: delete the shortcut in Startup or run uninstall-startup.ps1" -ForegroundColor Gray
