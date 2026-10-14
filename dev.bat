@echo off
title Bedrock Dedicated Server Manager - Dev Mode
echo ===================================================
echo  Starting Bedrock Server Manager (Dev Mode)
echo ===================================================
echo Backend API : http://localhost:3001
echo Frontend UI : http://localhost:5173
echo.
call npm.cmd run dev
pause
