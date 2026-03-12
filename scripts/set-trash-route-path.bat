@echo off
REM Set TRASH_ROUTE_PATH for this session so start-backend finds the MC-CARP API.
REM Edit the path below to match your trash-route folder (the one that contains src\api_main.py).

set "TRASH_ROUTE_PATH=C:\trash-route"

echo TRASH_ROUTE_PATH=%TRASH_ROUTE_PATH%
echo Now run start-all.bat or start-backend.bat in this same CMD window.
