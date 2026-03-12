# Load deepseek model and start LMS server (port 1234).
# Run manually or use install-lms-startup.ps1 to run at Windows login.
# When run by double-click, window stays open on error or exit so you can see what happened.

$ErrorActionPreference = "Stop"

function KeepWindowOpenIfNeeded {
  param([string]$Message = "Press Enter to close")
  if ($Host.Name -eq "ConsoleHost") { Read-Host $Message }
}

try {
  if (-not (Get-Command lms -ErrorAction SilentlyContinue)) {
    Write-Host "lms not found. Install LM Studio / lms CLI and ensure it is on PATH." -ForegroundColor Red
    KeepWindowOpenIfNeeded
    exit 1
  }

  Write-Host "Loading deepseek model (deepseek/deepseek-r1-0528-qwen3-8b)..." -ForegroundColor Cyan
  lms load deepseek/deepseek-r1-0528-qwen3-8b
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Model load failed." -ForegroundColor Red
    KeepWindowOpenIfNeeded
    exit $LASTEXITCODE
  }

  Write-Host "Starting LMS server on port 1234..." -ForegroundColor Cyan
  lms server start
  $code = $LASTEXITCODE
  Write-Host "Server stopped (exit code $code)." -ForegroundColor Yellow
  KeepWindowOpenIfNeeded
  exit $code
} catch {
  Write-Host "Error: $_" -ForegroundColor Red
  KeepWindowOpenIfNeeded
  exit 1
}
