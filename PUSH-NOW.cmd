@echo off
REM Direct push using PAT - works even if remote URL was reset.
cd /d "%~dp0"

set REPO_OWNER=mohanapriya63085
set REPO_NAME=ats
REM T-190 redaction (P0 #1 from SECRETS-AUDIT.md): rotated; literal removed.
REM Set GH_PAT env var before running: set GH_PAT=ghp_yournewpat
if "%GH_PAT%"=="" (
    echo ERROR: GH_PAT env var not set. Run: set GH_PAT=ghp_yournewpat then re-run this script.
    exit /b 1
)
set PAT=%GH_PAT%

echo ============================================================
echo  ATS - Direct push to GitHub (PAT auth)
echo ============================================================
echo.

git add .
git commit -m "backend: bind 0.0.0.0 inside container so docker port-map works" 2>nul
if errorlevel 1 echo (nothing new to commit, will still push existing commits)

echo Pushing...
git push "https://%REPO_OWNER%:%PAT%@github.com/%REPO_OWNER%/%REPO_NAME%.git" HEAD:main
set RC=%ERRORLEVEL%

echo.
if "%RC%"=="0" (
    echo DONE. https://github.com/%REPO_OWNER%/%REPO_NAME%/actions
) else (
    echo FAILED - exit %RC%
)
echo.
pause
