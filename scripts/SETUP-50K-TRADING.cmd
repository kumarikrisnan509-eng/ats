@echo off
REM ============================================================
REM SETUP-50K-TRADING.cmd
REM
REM One-shot configurator for the automated trading plan in
REM deploy/docs/AUTOMATED-TRADING-PLAN.md (T-258).
REM
REM Does:
REM   1. POST risk caps to /api/risk/config (Phase 1 paper-safe)
REM   2. PUT autorun config to /api/autorun (supertrend NIFTYBEES 60-min)
REM   3. PUT 4 monthly DCA SIPs to /api/sip (NIFTYBEES/JUNIORBEES/GOLDBEES/MOM100)
REM
REM Requires: ats_session cookie from Chrome DevTools.
REM Safe to re-run.
REM ============================================================

setlocal enabledelayedexpansion
set BASE=https://ats.rajasekarselvam.com

echo.
echo == ATS 50K Trading Setup ==
echo Base URL: %BASE%
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
echo [2/4] Applying risk caps...
curl -sS -X POST -b "ats_session=^!COOKIE^!" -H "X-CSRF-Token: ^!CSRF^!" -H "Content-Type: application/json" -d "{\"maxPositionSizeINR\":2500,\"maxDailyLossINR\":1000,\"maxWeeklyLossINR\":2500,\"maxDrawdownPct\":15,\"maxOpenPositions\":3,\"maxTradesPerDay\":5,\"minTradeIntervalMin\":15,\"allowedSegments\":[\"NSE\"],\"allowedProducts\":[\"CNC\",\"MIS\"],\"killSwitchDrawdownPct\":8}" "%BASE%/api/risk/config"
echo.

echo.
echo [3/4] Configuring autorun (supertrend on NIFTYBEES, 60-min)...
curl -sS -X PUT -b "ats_session=^!COOKIE^!" -H "X-CSRF-Token: ^!CSRF^!" -H "Content-Type: application/json" -d "{\"enabled\":true,\"strategy\":\"supertrend\",\"symbol\":\"NIFTYBEES\",\"qty\":1,\"intervalMinutes\":60,\"candleLookbackDays\":30}" "%BASE%/api/autorun"
echo.

echo.
echo [4/4] Creating 4 monthly DCA SIPs...
curl -sS -X PUT -b "ats_session=^!COOKIE^!" -H "X-CSRF-Token: ^!CSRF^!" -H "Content-Type: application/json" -d "{\"sips\":[{\"id\":\"lt-niftybees-50k\",\"enabled\":true,\"name\":\"50K: NIFTYBEES core\",\"symbol\":\"NIFTYBEES\",\"targetKind\":\"etf\",\"frequency\":\"monthly\",\"amountINR\":1500,\"dayOfMonth\":5},{\"id\":\"lt-juniorbees-50k\",\"enabled\":true,\"name\":\"50K: JUNIORBEES satellite\",\"symbol\":\"JUNIORBEES\",\"targetKind\":\"etf\",\"frequency\":\"monthly\",\"amountINR\":500,\"dayOfMonth\":5},{\"id\":\"lt-goldbees-50k\",\"enabled\":true,\"name\":\"50K: GOLDBEES hedge\",\"symbol\":\"GOLDBEES\",\"targetKind\":\"etf\",\"frequency\":\"monthly\",\"amountINR\":400,\"dayOfMonth\":5},{\"id\":\"lt-mom100-50k\",\"enabled\":true,\"name\":\"50K: MOM100 intl\",\"symbol\":\"MOM100\",\"targetKind\":\"etf\",\"frequency\":\"monthly\",\"amountINR\":400,\"dayOfMonth\":5}]}" "%BASE%/api/sip"
echo.

echo.
echo == Done ==
echo Verify:
echo   %BASE%/#stpswp   - should show 4 SIPs
echo   %BASE%/#risk     - caps match Step 2
echo   %BASE%/#paper    - autorun fires within 60min
echo.
echo Phase 1 paper validation: 4 weeks. KILL_SWITCH stays ON.
echo See deploy/docs/AUTOMATED-TRADING-PLAN.md for the full plan.
pause
