@echo off
REM CHECK-BEFORE-PUSH.cmd
REM
REM Catches the kind of CI failure that hit runs #99-#101 in May 2026:
REM   "Missing: <pkg>@<version> from lock file"
REM
REM Cause: a dependency was added to deploy/backend/package.json but
REM npm install was not run, so package-lock.json drifted out of sync.
REM GitHub Actions runs `npm ci` which strictly enforces lockfile sync
REM and bombs the validate step.
REM
REM Run this before `git push` to catch lockfile drift locally.
REM On drift: `cd deploy\backend && npm install` regenerates the lockfile.

setlocal
set REPO_ROOT=%~dp0

echo.
echo === Lockfile drift check (deploy/backend) ===
pushd "%REPO_ROOT%deploy\backend"
if errorlevel 1 (
    echo !! could not enter deploy\backend
    exit /b 1
)

call npm run lock:check
set LOCK_EXIT=%ERRORLEVEL%
popd

if not "%LOCK_EXIT%"=="0" (
    echo.
    echo !! LOCKFILE DRIFT DETECTED -- this WILL fail CI.
    echo    Fix:  cd deploy\backend ^&^& npm install
    echo    Then: git add deploy/backend/package-lock.json
    exit /b 1
)

echo.
echo === All pre-push checks passed. Safe to git push. ===
exit /b 0
