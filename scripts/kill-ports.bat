@echo off
REM Kill any process using trashroute-mobile ports (3000 = tRPC API, 19007 = Expo Metro).
REM Run this to free the ports, or it runs automatically before start-all.

set "PORTS=3000 19007"
for %%P in (%PORTS%) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":%%P " ^| findstr "LISTENING"') do (
    taskkill /PID %%A /F 2>nul && echo Killed PID %%A on port %%P
  )
)
echo Ports 3000 and 19007 are clear for trashroute-mobile.
exit /b 0
