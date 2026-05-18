@echo off
REM ============================================================
REM  SETUP-SMTP-ON-VM.cmd — T-165 operator helper.
REM
REM  What it does:
REM    1. Prompts you (interactively, no echo) for the Hostinger
REM       SMTP password.
REM    2. SSHs into the Oracle VM and appends the SMTP env block
REM       to /etc/ats/backend.env via `sudo tee -a`.
REM    3. Restarts the ats-backend container so the new env is read.
REM    4. Clears %SMTP_PASS% from this shell after use.
REM
REM  Safety properties:
REM    - The password is NEVER written to any file by this script.
REM    - It lives only in the %SMTP_PASS% env var, only inside this
REM      cmd.exe process, only for the duration of the script.
REM    - The remote /etc/ats/backend.env is the only persistent home.
REM    - This .cmd file itself contains zero secrets — safe to commit.
REM ============================================================

setlocal enableextensions
cd /d "%~dp0"

set VM=ubuntu@141.148.192.4
set KEY=C:\Users\localuserwin11\Downloads\ssh-key-2026-01-15.key
set ENV_FILE=/etc/ats/backend.env

echo.
echo === ATS SMTP setup (Hostinger) ===
echo VM:       %VM%
echo Env file: %ENV_FILE%
echo.
echo Paste the password for support@rajasekarselvam.com (from Hostinger hPanel).
echo It will NOT echo to the screen.
echo.

REM set /p does not natively hide input on cmd.exe. We use PowerShell to read it
REM securely and round-trip via an env var that we clear at the end.
for /f "delims=" %%i in ('powershell -Command "$p = Read-Host -AsSecureString 'SMTP_PASS'; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p))"') do set "SMTP_PASS=%%i"

if "%SMTP_PASS%"=="" (
    echo ERROR: empty password. Aborting.
    exit /b 1
)

echo.
echo Appending SMTP block to %ENV_FILE% on the VM...

REM Build the env block, pipe to ssh, write via sudo tee.
REM The block goes through stdin -> ssh -> remote shell -> sudo tee.
REM No disk write happens on this machine.
(
    echo.
    echo # ----- T-165 Hostinger SMTP added %DATE% %TIME% -----
    echo EMAIL_PROVIDER=smtp
    echo EMAIL_FROM=support@rajasekarselvam.com
    echo EMAIL_TO=support@rajasekarselvam.com
    echo SMTP_HOST=smtp.hostinger.com
    echo SMTP_PORT=465
    echo SMTP_USER=support@rajasekarselvam.com
    echo SMTP_PASS=%SMTP_PASS%
) | ssh -i "%KEY%" "%VM%" "sudo tee -a %ENV_FILE% >/dev/null && sudo chmod 600 %ENV_FILE%"

if errorlevel 1 (
    echo ERROR: ssh/tee failed. Check VM connectivity and sudo permissions.
    set "SMTP_PASS="
    exit /b 1
)

echo.
echo === Restarting ats-backend so it reads the new env ===
ssh -i "%KEY%" "%VM%" "cd /opt/ats/compose && sudo docker compose restart ats-backend"

if errorlevel 1 (
    echo WARN: restart command returned non-zero. Check VM manually.
)

echo.
echo === Verifying email-status (no password is returned) ===
ssh -i "%KEY%" "%VM%" "sleep 8 && curl -s http://127.0.0.1:8080/api/admin/email-status -H 'X-ATS-Internal: 1' | python3 -m json.tool 2>nul || curl -s http://127.0.0.1:8080/api/admin/email-status -H 'X-ATS-Internal: 1'"

echo.
echo === Cleanup: clearing SMTP_PASS from this shell ===
set "SMTP_PASS="
echo Done. Run SEND-TEST-EMAIL.cmd next to verify SMTP actually delivers.
echo.
pause
endlocal
