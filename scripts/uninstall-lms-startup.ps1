# Remove LMS (deepseek + server) from Windows Startup.

$startupFolder = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupFolder "LMS-Deepseek-Server.lnk"

if (Test-Path $shortcutPath) {
    Remove-Item $shortcutPath -Force
    Write-Host "Removed from Startup: LMS-Deepseek-Server.lnk" -ForegroundColor Green
} else {
    Write-Host "No LMS shortcut found in Startup." -ForegroundColor Yellow
}
