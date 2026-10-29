@echo off
title SoundHound ^| Amelia Custom Metrics Report
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed on this computer.
  echo Install the LTS version from https://nodejs.org , then double-click this file again.
  echo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo First start: installing the app. This takes about a minute and needs internet.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo The install did not finish. Check your internet connection and try again.
    pause
    exit /b 1
  )
)
echo.
echo Starting SoundHound ^| Amelia Custom Metrics Report ...
echo The page opens in your browser. Close this window to stop the app.
echo.
start "" /min cmd /c "timeout /t 3 >nul & start http://127.0.0.1:8740"
node server.js
pause
