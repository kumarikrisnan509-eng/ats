@echo off
REM INSTALL-SYNC-TASK.cmd (T-495)
REM
REM Registers a Windows Scheduled Task that runs SYNC-FROM-GITHUB.cmd
REM every 5 minutes in the background. After that your local working
REM tree is never more than 5 min behind origin/main, hands-free.
REM
REM Run this ONCE. Re-run to reapply if you change the schedule.
REM Removes any prior copy of the same task name first so re-runs are safe.
REM
REM Useful management commands (the task name is "ATS-Auto-Sync"):
REM   schtasks /Query  /TN ATS-Auto-Sync /V /FO LIST   (inspect)
REM   schtasks /Run    /TN ATS-Auto-Sync                (run on demand)
REM   schtasks /End    /TN ATS-Auto-Sync                (kill in-flight)
REM   schtasks /Delete /F /TN ATS-Auto-Sync             (uninstall)

setlocal
cd /d "%~dp0"

set "TASKNAME=ATS-Auto-Sync"
set "SCRIPT=%~dp0SYNC-FROM-GITHUB.cmd"

echo.
echo === Installing scheduled task ===
echo Name:      %TASKNAME%
echo Script:    %SCRIPT%
echo Schedule:  every 5 minutes, hidden, current user
echo.

if not exist "%SCRIPT%" (
    echo !! %SCRIPT% not found. Re-run after a successful SYNC-FROM-GITHUB.cmd pull.
    exit /b 1
)

REM Remove any prior copy first so this is idempotent.
schtasks /Query /TN "%TASKNAME%" >nul 2>&1
if not errorlevel 1 (
    echo Removing previous "%TASKNAME%" task...
    schtasks /Delete /F /TN "%TASKNAME%" >nul 2>&1
)

REM Wrap the .cmd in PowerShell -WindowStyle Hidden so the task fires
REM without a flashing console window every 5 minutes.
set "TR=powershell.exe -NoProfile -WindowStyle Hidden -Command \"& cmd.exe /c '%SCRIPT%'\""

schtasks /Create /F /SC MINUTE /MO 5 /TN "%TASKNAME%" /TR "%TR%" /RL LIMITED /IT
if errorlevel 1 (
    echo.
    echo !! schtasks /Create failed. If the message mentions privileges, re-run
    echo !! this script from an "Administrator: Command Prompt" once.
    exit /b 1
)

echo.
echo === Verifying ===
schtasks /Query /TN "%TASKNAME%" /FO LIST | findstr /R "TaskName Status Next"

echo.
echo === Running once now to prove it works ===
call "%SCRIPT%"
if errorlevel 1 (
    echo !! initial sync run failed -- check .secrets-local\.sync.log
    exit /b 1
)

echo.
echo === DONE ===
echo The task is now installed and will fire every 5 minutes.
echo Logs:    .secrets-local\.sync.log
echo Uninstall: schtasks /Delete /F /TN "%TASKNAME%"
exit /b 0
