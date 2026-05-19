@echo off
REM Recover stuck git state + push pending tiers 57+58 to GitHub.
REM   1. Remove stale .git/index.lock left by sandbox attempt
REM   2. Pull --rebase to merge upstream changes (CI may have auto-committed)
REM   3. Stage all changes, commit
REM   4. Push using PAT

cd /d "%~dp0"
set REPO_OWNER=kumarikrisnan509-eng
set REPO_NAME=ats
REM T-190 redaction (P0 #1 from SECRETS-AUDIT.md): rotated; literal removed.
REM Set GH_PAT env var before running: set GH_PAT=ghp_yournewpat
if "%GH_PAT%"=="" (
    echo ERROR: GH_PAT env var not set. Run: set GH_PAT=ghp_yournewpat then re-run this script.
    exit /b 1
)
set PAT=%GH_PAT%

echo ============================================================
echo  ATS - Fix git state and push tiers 57+58
echo ============================================================
echo.

echo [1/6] Remove stale index.lock if present...
if exist ".git\index.lock" (
    del /f ".git\index.lock"
    echo     removed .git\index.lock
) else (
    echo     no lock file -- skipping
)
echo.

echo [2/6] Stage all current changes (Tier 57+58 files)...
git add -A
echo.

echo [3/6] Commit local work BEFORE rebase (so working tree is clean)...
git commit -m "Tier 57+58: per-user broker credentials + per-user REST routing" 2>nul
if errorlevel 1 echo     nothing new to commit (everything already committed)
echo.

echo [4/6] Pull --rebase to integrate any remote commits...
git pull --rebase "https://%REPO_OWNER%:%PAT%@github.com/%REPO_OWNER%/%REPO_NAME%.git" main
if errorlevel 1 (
    echo.
    echo     !! pull --rebase failed. There may be conflicts.
    echo     !! Resolve manually: open conflicting files, fix, then run:
    echo        git add ^<resolved-file^>
    echo        git rebase --continue
    echo        then re-run this script.
    echo.
    echo     To abort and start over:
    echo        git rebase --abort
    pause
    exit /b 1
)
echo.

echo [5/6] Push to origin/main...
git push "https://%REPO_OWNER%:%PAT%@github.com/%REPO_OWNER%/%REPO_NAME%.git" HEAD:main
set RC=%ERRORLEVEL%
echo.

echo [6/6] Show last 3 commits...
git log --oneline -3
echo.

if %RC%==0 (
    echo ============================================================
    echo  SUCCESS - push complete. CI deploy will run in ^~2 minutes.
    echo  Next: wait for the deploy, then run MIGRATE-BROKER-ENV-TO-DB.cmd
    echo ============================================================
) else (
    echo ============================================================
    echo  FAILED with exit code %RC%
    echo ============================================================
)
pause
