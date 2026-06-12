@echo off
chcp 65001 >nul
title Cloudfiles Setup

echo.
echo ========================================
echo   Cloudfiles Setup v2.0.0 (API Mode)
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

echo [Running] Setup...
echo.

node setup.js

echo.
pause
