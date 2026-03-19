@echo off
REM Start RouteMaster/trash-route-api (port 8003)
if defined BACKEND_PATH goto :found
set "BACKEND_PATH=%~dp0..\..\..\backend\trash-route-api"
if exist "%BACKEND_PATH%\app\main.py" goto :found
set "BACKEND_PATH=%~dp0..\..\trash-route-api"
if exist "%BACKEND_PATH%\app\main.py" goto :found
echo RouteMaster API not found. Set BACKEND_PATH to the folder containing app\main.py
exit /b 1
:found
cd /d "%BACKEND_PATH%"
echo Starting RouteMaster API on http://localhost:8003...
python -m uvicorn app.main:app --host 0.0.0.0 --port 8003
