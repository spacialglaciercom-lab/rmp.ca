# Add LMS (deepseek model + server) to Windows Startup.
# Run once: right-click -> Run with PowerShell, or: powershell -ExecutionPolicy Bypass -File install-lms-startup.ps1

$ErrorActionPreference = "Stop"
$root = "C:\trashroute-mobile"
if (-not (Test-Path $root)) { $root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
$startLms = Join-Path $root "scripts\start-lms-deepseek.ps1"

$startupFolder = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupFolder "LMS-Deepseek-Server.lnk"

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -NoExit -WindowStyle Minimized -File `"$startLms`""
$shortcut.WorkingDirectory = $root
$shortcut.Description = "Load deepseek model and start LMS server on port 1234 at login"
$shortcut.Save()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($wsh) | Out-Null

Write-Host "Added to Startup: $shortcutPath" -ForegroundColor Green
Write-Host "LMS (deepseek model + server on port 1234) will start automatically when you log in." -ForegroundColor Cyan
Write-Host "To remove: delete the shortcut in Startup or run uninstall-lms-startup.ps1" -ForegroundColor Gray
