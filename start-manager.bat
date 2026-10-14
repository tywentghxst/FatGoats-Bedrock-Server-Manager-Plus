@echo off
title Bedrock Dedicated Server Manager
echo ===================================================
echo  Bedrock Dedicated Server Manager Launcher
echo ===================================================
echo.

cd /d "%~dp0"

:: 1. Verify Node.js is installed
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js was not found on your system!
    echo Node.js is required to run the server manager.
    echo Please download and install Node.js from https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: 2. Launch native Windows Tray Launcher (with GUI setup & progress bar)
if exist "%~dp0BedrockServerManager.exe" (
    echo Launching native Windows Launcher (BedrockServerManager.exe)...
    echo The app will sit in your Windows Taskbar Overflow Tray.
    echo Web Dashboard: http://localhost:3001
    echo.
    start "" "%~dp0BedrockServerManager.exe"
    exit /b 0
)

:: 3. CLI Fallback if BedrockServerManager.exe is not present
if not exist "node_modules\" (
    echo [First-Time Setup] Installing server dependencies from package.json...
    call npm install --omit=dev --no-audit --no-fund
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
)

if not exist "client\dist\index.html" (
    echo [First-Time Setup] Building web dashboard assets...
    cd client
    if not exist "node_modules\" call npm install --no-audit --no-fund
    call npm run build
    cd ..
)

echo Starting Bedrock Server Manager...
start http://localhost:3001
node server/index.js
