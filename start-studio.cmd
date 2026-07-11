@echo off
setlocal
cd /d "%~dp0"
title Pixiv-to-Manga Studio

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 LTS or newer is required.
  echo Download it from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing dependencies ^(this can take a few minutes^)...
  call npm install
  if errorlevel 1 (
    echo Dependency install failed. See the messages above.
    pause
    exit /b 1
  )
)

echo Starting Pixiv-to-Manga Studio... the app will open in your browser.
echo Keep this window open while you work; close it to stop the studio.
call npm start
pause
