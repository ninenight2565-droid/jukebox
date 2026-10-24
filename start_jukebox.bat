@echo off
chcp 65001 >nul
title Restaurant Jukebox V2
color 0b
echo =========================================================
echo       🎵 RESTAURANT JUKEBOX V2 - AUTO STARTUP 🎵
echo =========================================================
echo.
cd /d "%~dp0"

echo [1/3] กำลังเคลียร์พอร์ต 8888 เก่า (ถ้ามี)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8888 ^| findstr LISTENING') do (
    echo - ปิด Process เดิม PID: %%a
    taskkill /F /PID %%a >nul 2>&1
)

echo [2/3] กำลังสตาร์ท Node.js Backend Server...
start "Jukebox Server" cmd /k "cd /d "%~dp0server" && node server.js"

echo - รอระบบเซิร์ฟเวอร์เปิดสักครู่...
timeout /t 3 /nobreak >nul

echo [3/3] เปิดหน้าจอเครื่องเล่นเพลง (Player) บนเบราว์เซอร์อัตโนมัติ...
start http://localhost:8888/player

echo.
echo =========================================================
echo  ✅ ระบบพร้อมใช้งานเรียบร้อยแล้ว!
echo.
echo  📺 หน้าจอทีวีเล่นเพลง (Player) : http://localhost:8888/player
echo  📱 หน้าขอเพลงสำหรับลูกค้า      : http://localhost:8888/
echo  🔒 หน้าควบคุมสำหรับแอดมิน      : http://localhost:8888/admin (PIN: 1234)
echo =========================================================
echo.
echo กดปุ่มใดๆ เพื่อปิดหน้าต่างนี้ (เซิร์ฟเวอร์จะยังคงทำงานในหน้าต่างสีดำเบื้องหลัง)
pause >nul
