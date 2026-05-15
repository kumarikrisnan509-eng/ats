@echo off
cd /d "%~dp0"
title Tier 57 - Migrate env Zerodha creds into per-user broker_accounts row
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\deploy\scripts\migrate-broker-env-to-db.ps1"
echo.
pause
