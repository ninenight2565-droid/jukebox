@echo off
title Restaurant Jukebox V2
color 0b
echo =========================================================
echo        RESTAURANT JUKEBOX V2 - AUTO STARTUP
echo =========================================================
echo.

cd /d "%~dp0"

if not exist "server" (
    echo [ERROR] server folder not found!
    echo Please place this batch file in the root project directory.
    echo.
    pause
    exit /b
)

echo [1/3] Checking Port 8888...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8888 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

echo [2/3] Starting Server...
start "Jukebox Server" cmd /k "cd /d ""%~dp0server"" && node server.js"

ping 127.0.0.1 -n 3 >nul

echo [3/3] Launching Player TV Dashboard...
start http://localhost:8888/player

echo.
echo =========================================================
echo   [READY] Jukebox is now running!
echo   - Player TV Screen : http://localhost:8888/player
echo   - User Page        : http://localhost:8888/
echo   - Admin Panel      : http://localhost:8888/admin (PIN: 1234)
echo =========================================================
echo.
pause
