@echo off
cd /d "%~dp0"
title Push Tier 57+58 via GitHub REST API
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\deploy\scripts\push-tier-57-58.ps1"
echo.
pause
