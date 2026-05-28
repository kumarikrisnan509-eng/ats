@echo off
REM SYNC-FROM-GITHUB.cmd v2 (T-495 hardened)
REM
REM Pulls origin/main into the local working tree, safely.
REM
REM Hardening over v1:
REM   - auto-cleans stale .git/index.lock (no manual intervention)
REM   - silently stashes any uncommitted local changes before reset,
REM     so a periodic run can never destroy WIP. Recover with:
REM         git stash list
REM         git stash pop
REM   - logs every run to .secrets-local\.sync.log (overwritten when > 1 MB)
REM   - quiet on success; non-zero exit only on real failure
REM
REM Designed to be triggered every N minutes from Windows Task Scheduler
REM (see INSTALL-SYNC-TASK.cmd). Manual double-click also works.
REM
REM Exit codes: 0 = synced or already up-to-date, 1 = error.

setlocal
cd /d "%~dp0"

if not exist .secrets-local mkdir .secrets-local
set "LOGFILE=.secrets-local\.sync.log"

REM Truncate log if it exceeds ~1 MB so it can't grow unbounded.
if exist "%LOGFILE%" for %%F in ("%LOGFILE%") do if %%~zF GTR 1048576 (
    if exist "%LOGFILE%.old" del /F /Q "%LOGFILE%.old"
    move /Y "%LOGFILE%" "%LOGFILE%.old" >nul
)

REM Timestamp via PowerShell (wmic is deprecated on Win11).
for /f "delims=" %%a in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH:mm:ss"') do set "TS=%%a"

>>"%LOGFILE%" echo.
>>"%LOGFILE%" echo [%TS%] ===== sync run =====

REM Clean stale index.lock (left behind by an interrupted git process).
if exist ".git\index.lock" (
    >>"%LOGFILE%" echo [%TS%] removing stale .git\index.lock
    del /F /Q ".git\index.lock" 2>>"%LOGFILE%"
)

REM Fetch.
git fetch origin >>"%LOGFILE%" 2>&1
if errorlevel 1 (
    >>"%LOGFILE%" echo [%TS%] !! fetch failed
    exit /b 1
)

REM Already up-to-date?
for /f %%a in ('git rev-parse HEAD 2^>nul') do set "LOCAL_SHA=%%a"
for /f %%a in ('git rev-parse origin/main 2^>nul') do set "REMOTE_SHA=%%a"
if "%LOCAL_SHA%"=="%REMOTE_SHA%" (
    >>"%LOGFILE%" echo [%TS%] already at %REMOTE_SHA% -- no-op
    exit /b 0
)

>>"%LOGFILE%" echo [%TS%] local=%LOCAL_SHA% remote=%REMOTE_SHA% -- syncing

REM If there are any uncommitted changes (tracked OR untracked-but-modified),
REM stash them silently so the upcoming `reset --hard` can't destroy them.
git diff --quiet HEAD 2>nul
if errorlevel 1 (
    >>"%LOGFILE%" echo [%TS%] stashing uncommitted changes (recover with: git stash list / git stash pop)
    git stash push -u -m "auto-stash by SYNC-FROM-GITHUB %TS%" >>"%LOGFILE%" 2>&1
)

REM Hard reset to origin/main.
git reset --hard origin/main >>"%LOGFILE%" 2>&1
if errorlevel 1 (
    >>"%LOGFILE%" echo [%TS%] !! reset failed
    exit /b 1
)

>>"%LOGFILE%" echo [%TS%] OK -- now at %REMOTE_SHA%
exit /b 0
