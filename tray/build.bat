@echo off
title Build BedrockServerManager.exe
echo ===================================================
echo  Building Native Windows System Tray Executable
echo ===================================================
echo.
set CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe

if not exist "%CSC%" (
    echo Error: C# compiler not found at %CSC%
    pause
    exit /b 1
)

echo Compiling tray\Program.cs ...
"%CSC%" /target:winexe /out:..\BedrockServerManager.exe /win32icon:app.ico /r:System.dll,System.Drawing.dll,System.Windows.Forms.dll,System.Core.dll Program.cs

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ===================================================
    echo  SUCCESS: BedrockServerManager.exe built!
    echo ===================================================
) else (
    echo.
    echo Error during compilation.
)
pause
