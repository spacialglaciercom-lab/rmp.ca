@echo off
REM Start app + backend(s) - opens new windows. Uses pnpm if available, else npm.
REM Ports 3000 (tRPC) and 19007 (Expo) are reserved for this project; we clear them first.
set "ROOT=%~dp0.."
cd /d "%ROOT%"
call "%~dp0kill-ports.bat"
echo Starting trashroute-mobile stack...
set "PATH=%APPDATA%\npm;%ProgramFiles%\nodejs;%PATH%"
REM Use pnpm if available, otherwise npm run dev
start "Expo + tRPC" cmd /k "cd /d "%ROOT%" && set "PATH=%APPDATA%\npm;%ProgramFiles%\nodejs;%PATH%" && (where pnpm >nul 2>nul && pnpm dev || npm run dev)"
timeout /t 2 /nobreak >nul
start "MC-CARP API" cmd /k "cd /d "%~dp0" && set "PATH=%APPDATA%\npm;%ProgramFiles%\nodejs;%PATH%" && start-backend.bat"
timeout /t 1 /nobreak >nul
set "ROUTEMASTER_PATH=%~dp0..\..\..\backend\trash-route-api"
if not exist "%ROUTEMASTER_PATH%\app\main.py" set "ROUTEMASTER_PATH=%~dp0..\..\trash-route-api"
if exist "%ROUTEMASTER_PATH%\app\main.py" (
  start "RouteMaster (map match)" cmd /k "cd /d "%~dp0" && set "PATH=%APPDATA%\npm;%ProgramFiles%\nodejs;%PATH%" && start-routemaster.bat"
  echo Launched: Expo + tRPC, MC-CARP, and RouteMaster.
) else (
  echo RouteMaster skipped (trash-route-api not found). Set BACKEND_PATH in start-routemaster.bat if you have it elsewhere.
  echo Launched: Expo + tRPC and MC-CARP.
)
echo.
echo MC-CARP runs only if TRASH_ROUTE_PATH is set or trash-route is in a default location.
echo Close the spawned windows to stop.
pause
