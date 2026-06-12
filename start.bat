@echo off
chcp 65001 >nul
title Cloudfiles Server

echo.
echo ========================================
echo   Cloudfiles v2.0.0
echo ========================================
echo.

cd /d "%~dp0"

:: Install project dependencies
if not exist "node_modules" (
    echo [Installing] Dependencies...
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERROR] Failed to install dependencies!
        pause
        exit /b 1
    )
    echo.
)

echo [Starting] Server...
echo.

start "Cloudfiles Server" cmd /k "node server.js"

timeout /t 3 /nobreak >nul

echo [Opening] Browser...
start http://localhost:8000

echo.
echo ========================================
echo   Server started!
echo   URL: http://localhost:8000
echo.
echo   Close this window will NOT stop server
echo   To stop: close "Cloudfiles Server" window
echo ========================================
echo.

timeout /t 5 /nobreak >nul
