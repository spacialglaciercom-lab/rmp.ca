@echo off
REM Clear Expo login state and cached dev certificate so you can log in with a new account.
REM Fixes: "Could not fetch new Expo development certificate, falling back to cached certificate"
REM Run from project root: scripts\clear-expo-login-and-certs.bat

cd /d "%~dp0.."
set "ROOT=%CD%"

echo.
echo === Clear Expo login and certificate cache ===
echo.

REM 1. Log out of Expo (clears session)
echo Logging out of Expo...
call npx expo logout 2>nul
echo.

REM 2. Remove user-level Expo cache (auth state + cached dev certificate)
set "USER_EXPO=%USERPROFILE%\.expo"
if exist "%USER_EXPO%" (
  rmdir /s /q "%USER_EXPO%"
  echo    Removed %USER_EXPO%
) else (
  echo    User .expo not found
)

REM 3. Remove project .expo
if exist "%ROOT%\.expo" (
  rmdir /s /q "%ROOT%\.expo"
  echo    Removed project .expo
)

REM 4. Clear Metro/haste temp caches
del /q "%LOCALAPPDATA%\Temp\haste-map-*" 2>nul
if exist "%LOCALAPPDATA%\Temp\metro-cache" rmdir /s /q "%LOCALAPPDATA%\Temp\metro-cache" 2>nul
echo    Cleared Metro temp caches
echo.

echo Done. Next steps:
echo   1. Log in with your NEW account (in a separate terminal):
echo      npx expo login
echo   2. Start the app with a clean bundle:
echo      npx expo start --clear
echo.
echo If certificate fetch still fails, check: internet, firewall, or try another network.
echo.
exit /b 0
