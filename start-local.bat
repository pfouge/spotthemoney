@echo off
REM Spot the Money - start the local dev server.
REM Double-click this file, then open http://localhost:4321 in your browser.
REM Requires Node 20+ (https://nodejs.org). Press Ctrl+C in this window to stop.

cd /d "C:\Users\pfoug\OneDrive\Documents\Claude Code Personal\spotthemoney.com"

if not exist node_modules (
  echo Installing dependencies ^(first run only, may take a minute^)...
  call npm install
  if errorlevel 1 goto error
)

echo.
echo Starting dev server... open http://localhost:4321
echo.
call npm run dev
if errorlevel 1 goto error
goto end

:error
echo.
echo Something went wrong. If you saw "npm is not recognized", install Node 20+ from https://nodejs.org and try again.

:end
pause
