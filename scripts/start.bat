@echo off
REM Start Expo + tRPC dev server (uses pnpm if available, else npm)
cd /d "%~dp0.."
set "PATH=%APPDATA%\npm;%ProgramFiles%\nodejs;%PATH%"
echo Starting trashroute-mobile (Expo + tRPC server)...
where pnpm >nul 2>nul && pnpm dev || npm run dev
