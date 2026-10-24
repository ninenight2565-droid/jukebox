@echo off
title Restaurant Jukebox V2
color 0b
echo =========================================================
echo       RESTAURANT JUKEBOX V2 - AUTO STARTUP
echo =========================================================
echo.

cd /d "%~dp0"

echo [1/3] Checking Port 8888...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8888 ^| findstr LISTENING') do (
    echo Terminating old process on port 8888 (PID: %%a)...
    taskkill /F /PID %%a >nul 2>&1
)

echo [2/3] Starting Server...
start "Jukebox Server" cmd /k "cd /d "%~dp0server" && node server.js"

timeout /t 3 /nobreak >nul

echo [3/3] Launching Player TV Dashboard...
start http://localhost:8888/player

echo.
echo =========================================================
echo  [READY] Jukebox is now running!
echo  - Player TV Screen : http://localhost:8888/player
echo  - User Page        : http://localhost:8888/
echo  - Admin Panel      : http://localhost:8888/admin (PIN: 1234)
echo =========================================================
echo.
pause
