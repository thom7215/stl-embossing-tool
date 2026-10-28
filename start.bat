@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install it from https://nodejs.org then double-click start.bat again.
  pause
  exit /b 1
)
if not exist node_modules\three (
  echo Installing the 3D libraries...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node server.js
if errorlevel 1 pause
