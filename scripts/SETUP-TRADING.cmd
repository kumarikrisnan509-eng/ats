@echo off
REM ============================================================
REM SETUP-TRADING.cmd
REM
REM Configures the automated trading plan using YOUR capital as
REM input (not hardcoded). Computes risk caps + DCA amounts via
REM ratios from deploy/docs/AUTOMATED-TRADING-PLAN.md (T-258).
REM
REM Does:
REM   1. Asks for your capital (default 50000)
REM   2. Computes derived values:
REM        maxPositionSizeINR = capital * 0.05
REM        maxDailyLossINR    = capital * 0.02
REM        maxWeeklyLossINR   = capital * 0.05
REM        Monthly DCA total  = capital * 0.0545  (60% spread over 11 months)
REM          - NIFTYBEES  53.6%%
REM          - JUNIORBEES 17.9%%
REM          - GOLDBEES   14.3%%
REM          - MOM100     14.3%%
REM   3. POSTs risk caps to /api/risk/config
REM   4. PUTs autorun config to /api/autorun
REM   5. PUTs the 4 DCA SIPs to /api/sip
REM
REM Requires: ats_session cookie. Safe to re-run.
REM ============================================================

setlocal enabledelayedexpansion
set BASE=https://ats.rajasekarselvam.com

echo.
echo == ATS Automated Trading Setup ==
echo Base URL: %BASE%
echo.

REM ----- Step 1: get capital (with default) -----
set CAPITAL=50000
set /p CAPITAL="Trading capital INR [%CAPITAL%]: "
if "%CAPITAL%"=="" set CAPITAL=50000

REM ----- Compute derived values using PowerShell (Windows ships with it) -----
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "[int](%CAPITAL% * 0.05)"') do set MAX_POS=%%i
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "[int](%CAPITAL% * 0.02)"') do set MAX_DAY=%%i
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "[int](%CAPITAL% * 0.05)"') do set MAX_WEEK=%%i
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "[int](%CAPITAL% * 0.0292)"') do set DCA_NIFTYBEES=%%i
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "[int](%CAPITAL% * 0.0098)"') do set DCA_JUNIORBEES=%%i
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "[int](%CAPITAL% * 0.0078)"') do set DCA_GOLDBEES=%%i
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "[int](%CAPITAL% * 0.0078)"') do set DCA_MOM100=%%i

echo.
echo == Computed plan for capital INR %CAPITAL% ==
echo   Risk caps:
echo     maxPositionSizeINR  = %MAX_POS%   (5%% of capital)
echo     maxDailyLossINR     = %MAX_DAY%   (2%% of capital)
echo     maxWeeklyLossINR    = %MAX_WEEK%  (5%% of capital)
echo   Monthly DCA SIPs:
echo     NIFTYBEES  = %DCA_NIFTYBEES%
echo     JUNIORBEES = %DCA_JUNIORBEES%
echo     GOLDBEES   = %DCA_GOLDBEES%
echo     MOM100     = %DCA_MOM100%
echo.
set /p CONFIRM="Apply this plan? [y/N]: "
if /i not "%CONFIRM%"=="y" (echo Aborted. & exit /b 0)

REM ----- Step 2: get session cookie -----
echo.
echo Get your ats_session cookie:
echo   Chrome -^> F12 -^> Application -^> Cookies -^> ats.rajasekarselvam.com -^> ats_session
echo.
set /p COOKIE="Paste ats_session value: "
if "%COOKIE%"=="" (echo ERROR: no cookie. Aborting. & exit /b 1)

echo.
echo [1/4] Fetching CSRF token...
for /f "tokens=*" %%i in ('curl -sS -b "ats_session=^!COOKIE^!" "%BASE%/api/csrf-token"') do set CSRF_JSON=%%i
echo Response: %CSRF_JSON%
echo Extract the "token" value and paste it below.
set /p CSRF="Paste CSRF token: "
if "%CSRF%"=="" (echo ERROR: no CSRF. Aborting. & exit /b 1)

echo.
echo [2/4] Applying risk caps for capital INR %CAPITAL%...
curl -sS -X POST -b "ats_session=^!COOKIE^!" -H "X-CSRF-Token: ^!CSRF^!" -H "Content-Type: application/json" -d "{\"maxPositionSizeINR\":%MAX_POS%,\"maxDailyLossINR\":%MAX_DAY%,\"maxWeeklyLossINR\":%MAX_WEEK%,\"maxDrawdownPct\":15,\"maxOpenPositions\":3,\"maxTradesPerDay\":5,\"minTradeIntervalMin\":15,\"allowedSegments\":[\"NSE\"],\"allowedProducts\":[\"CNC\",\"MIS\"],\"killSwitchDrawdownPct\":8}" "%BASE%/api/risk/config"
echo.

echo.
echo [3/4] Configuring autorun (supertrend on NIFTYBEES, 60-min)...
curl -sS -X PUT -b "ats_session=^!COOKIE^!" -H "X-CSRF-Token: ^!CSRF^!" -H "Content-Type: application/json" -d "{\"enabled\":true,\"strategy\":\"supertrend\",\"symbol\":\"NIFTYBEES\",\"qty\":1,\"intervalMinutes\":60,\"candleLookbackDays\":30}" "%BASE%/api/autorun"
echo.

echo.
echo [4/4] Creating 4 monthly DCA SIPs (scaled to capital)...
curl -sS -X PUT -b "ats_session=^!COOKIE^!" -H "X-CSRF-Token: ^!CSRF^!" -H "Content-Type: application/json" -d "{\"sips\":[{\"id\":\"lt-niftybees-plan\",\"enabled\":true,\"name\":\"Plan: NIFTYBEES core\",\"symbol\":\"NIFTYBEES\",\"targetKind\":\"etf\",\"frequency\":\"monthly\",\"amountINR\":%DCA_NIFTYBEES%,\"dayOfMonth\":5},{\"id\":\"lt-juniorbees-plan\",\"enabled\":true,\"name\":\"Plan: JUNIORBEES satellite\",\"symbol\":\"JUNIORBEES\",\"targetKind\":\"etf\",\"frequency\":\"monthly\",\"amountINR\":%DCA_JUNIORBEES%,\"dayOfMonth\":5},{\"id\":\"lt-goldbees-plan\",\"enabled\":true,\"name\":\"Plan: GOLDBEES hedge\",\"symbol\":\"GOLDBEES\",\"targetKind\":\"etf\",\"frequency\":\"monthly\",\"amountINR\":%DCA_GOLDBEES%,\"dayOfMonth\":5},{\"id\":\"lt-mom100-plan\",\"enabled\":true,\"name\":\"Plan: MOM100 intl\",\"symbol\":\"MOM100\",\"targetKind\":\"etf\",\"frequency\":\"monthly\",\"amountINR\":%DCA_MOM100%,\"dayOfMonth\":5}]}" "%BASE%/api/sip"
echo.

echo.
echo == Done ==
echo Verify:
echo   %BASE%/#stpswp   - should show 4 SIPs scaled to INR %CAPITAL%
echo   %BASE%/#risk     - caps match Step 2
echo   %BASE%/#paper    - autorun fires within 60min
echo.
echo Re-run anytime with a different capital amount.
echo See deploy/docs/AUTOMATED-TRADING-PLAN.md for the full plan.
pause
