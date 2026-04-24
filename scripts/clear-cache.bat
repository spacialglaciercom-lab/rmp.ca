@echo off
REM Clear Expo/Metro caches so the latest UI and code load.
REM Run from project root or from scripts: scripts\clear-cache.bat

cd /d "%~dp0.."
set "ROOT=%CD%"

echo.
echo Clearing caches in: %ROOT%
echo.

if exist ".expo" (
  rmdir /s /q ".expo"
  echo    Removed .expo
) else (
  echo    .expo not found
)

if exist "node_modules\.cache" (
  rmdir /s /q "node_modules\.cache"
  echo    Removed node_modules\.cache
) else (
  echo    node_modules\.cache not found
)

echo.
echo Cache clear done.
echo.
echo Start the app with a clean bundle:
echo   npx expo start --clear
echo For web:
echo   npx expo start --web --clear
echo.
exit /b 0
