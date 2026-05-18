@echo off
REM SYNC-FROM-GITHUB.cmd
REM
REM Pulls the latest origin/main into the local working copy and
REM discards any local working-tree changes (including the CRLF/LF
REM line-ending noise that gets generated when files are edited
REM from the Linux sandbox).
REM
REM Use at the start of every session, BEFORE making any local edits,
REM so that GitHub remains the single source of truth.
REM
REM WARNING: this does `git reset --hard`. Any genuine uncommitted work
REM in the working tree WILL be discarded. If you're not sure, run
REM `git status` first and decide.

setlocal
cd /d "%~dp0"

echo.
echo === Fetching latest from origin ===
git fetch origin
if errorlevel 1 (
    echo !! git fetch failed -- check network / credentials.
    exit /b 1
)

echo.
echo === Current local state ===
git log --oneline -1
echo origin/main:
git log --oneline -1 origin/main

echo.
echo === Resetting local main to origin/main (hard) ===
git reset --hard origin/main
if errorlevel 1 (
    echo !! git reset failed. If error mentions 'index.lock', run:
    echo    Remove-Item ".git\index.lock" -Force
    echo    and try again.
    exit /b 1
)

echo.
echo === Local now matches GitHub ===
git log --oneline -1
echo.
exit /b 0
