@echo off
REM Free port 8081 (Metro default) so Expo can start. Run before "pnpm run mobile" if you get "Port 8081 is being used".
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8081 ^| findstr LISTENING') do (
  echo Killing PID %%a on port 8081
  taskkill /F /PID %%a 2>nul
)
echo Done. Now run: pnpm run mobile
