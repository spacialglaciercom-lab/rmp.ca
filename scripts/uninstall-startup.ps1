# Remove trashroute-mobile from Windows Startup.

$startupFolder = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupFolder "trashroute-mobile.lnk"

if (Test-Path $shortcutPath) {
  Remove-Item $shortcutPath -Force
  Write-Host "Removed from Startup: trashroute-mobile.lnk" -ForegroundColor Green
} else {
  Write-Host "No trashroute-mobile shortcut found in Startup." -ForegroundColor Yellow
}
