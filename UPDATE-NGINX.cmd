@echo off
cd /d "%~dp0"
title Update nginx for ats.rajasekarselvam.com -- add HSTS/CSP/XFO/nosniff headers
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\deploy\scripts\update-nginx-prod.ps1"
echo.
pause
