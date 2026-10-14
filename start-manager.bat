@echo off
title Bedrock Dedicated Server Manager
echo ===================================================
echo  Bedrock Dedicated Server Manager Launcher
echo ===================================================
echo.
echo Launching native Windows Tray App (BedrockServerManager.exe)...
echo The app will sit in your Windows Taskbar Overflow Tray.
echo Web Dashboard: http://localhost:3001
echo.
start "" "%~dp0BedrockServerManager.exe"
exit
