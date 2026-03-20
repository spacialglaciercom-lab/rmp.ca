@echo off
REM Always run from C:\trashroute-mobile (canonical project), clear caches, then start Expo.
REM Use this when you still see the OLD UI - forces Metro to serve the latest code.

set "PROJECT=C:\trashroute-mobile"
if not exist "%PROJECT%" (
  echo ERROR: Project not found at %PROJECT%
  echo Edit this script if your path is different.
  pause
  exit /b 1
)

cd /d "%PROJECT%"
echo.
echo >>> Running from: %PROJECT%
echo >>> Clearing caches...
echo.

if exist ".expo" (
  rmdir /s /q ".expo"
  echo    Removed .expo
)
if exist "node_modules\.cache" (
  rmdir /s /q "node_modules\.cache"
  echo    Removed node_modules\.cache
)

echo.
echo >>> Starting Expo with --clear (fresh bundle)...
echo >>> Press w for web, or scan QR for Expo Go.
echo.
call npx expo start --clear
exit /b 0
