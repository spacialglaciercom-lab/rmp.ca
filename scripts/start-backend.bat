@echo off
REM Start trash-route MC-CARP API (port 8000)
REM Set TRASH_ROUTE_PATH to your backend folder if not in default place, e.g. set TRASH_ROUTE_PATH=C:\path\to\trash-route

set "SCRIPTS=%~dp0"
set "ROOT=%~dp0.."
set "TRASH_ROUTE="

if defined TRASH_ROUTE_PATH (
  if exist "%TRASH_ROUTE_PATH%\src\api_main.py" set "TRASH_ROUTE=%TRASH_ROUTE_PATH%"
)
if not defined TRASH_ROUTE (
  if exist "%ROOT%\..\trash-route\src\api_main.py" set "TRASH_ROUTE=%ROOT%\..\trash-route"
)
if not defined TRASH_ROUTE (
  if exist "%ROOT%\..\..\trash-route\src\api_main.py" set "TRASH_ROUTE=%ROOT%\..\..\trash-route"
)
if not defined TRASH_ROUTE (
  if exist "%USERPROFILE%\trash-route\src\api_main.py" set "TRASH_ROUTE=%USERPROFILE%\trash-route"
)

if not defined TRASH_ROUTE (
  echo trash-route API not found.
  echo Set TRASH_ROUTE_PATH to your backend folder ^(where src\api_main.py is^).
  echo Expo + tRPC will keep running; only MC-CARP is skipped.
  pause
  exit /b 1
)

cd /d "%TRASH_ROUTE%\src"
echo Starting trash-route MC-CARP API on http://localhost:8000...
python -m uvicorn api_main:app --host 0.0.0.0 --port 8000 --reload
