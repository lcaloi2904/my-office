@echo off
setlocal
title My Office
rem One script to start My Office on Windows, with the saved OMP sessions, and open it in the browser.
rem   start-office.cmd              start (builds the web app first if needed) and open the browser
rem   start-office.cmd rebuild      rebuild the web app first, then start (use after pulling or changing code)
rem   start-office.cmd nobrowser    start without opening the browser
rem Stop it by closing this window or pressing Ctrl+C.
cd /d "%~dp0"

set "OFFICE_PORT=4310"
set "OFFICE_DIST_DIR=.next-win-p3"
set "NEXT_TELEMETRY_DISABLED=1"
set "URL=http://127.0.0.1:%OFFICE_PORT%"
set "REBUILD="
set "OPEN=1"
for %%A in (%*) do (
  if /i "%%A"=="rebuild" set "REBUILD=1"
  if /i "%%A"=="nobrowser" set "OPEN="
)

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install Node.js and run this again.
  pause
  exit /b 1
)
if not exist "node_modules\next\dist\bin\next" (
  echo The packages are not installed. Run npm install in this folder first.
  pause
  exit /b 1
)

rem Saved OMP sessions: only when the config exists. Otherwise the office starts without them.
if exist "%~dp0data\omp-config.json" (
  set "OFFICE_OMP=hybrid"
  set "OFFICE_OMP_CONFIG=%~dp0data\omp-config.json"
) else (
  echo Note: data\omp-config.json was not found, so OMP history is off.
)

rem Never start a second copy: if the port is taken the office is most likely already running.
netstat -ano | findstr /R /C:":%OFFICE_PORT% .*LISTENING" >nul
if not errorlevel 1 (
  echo Port %OFFICE_PORT% is already in use, the office is probably running at %URL%
  if defined OPEN start "" "%URL%"
  exit /b 0
)

if defined REBUILD goto build
if not exist "%OFFICE_DIST_DIR%\BUILD_ID" goto build
goto run

:build
echo Building the web app, this can take a few minutes...
rem The build reformats tsconfig.json; keep a copy and put it back so the working tree stays as it was.
copy /y tsconfig.json "%TEMP%\my-office-tsconfig.bak" >nul
node node_modules\next\dist\bin\next build
set "BUILD_RESULT=%errorlevel%"
copy /y "%TEMP%\my-office-tsconfig.bak" tsconfig.json >nul
if not "%BUILD_RESULT%"=="0" (
  echo The build failed, see the messages above.
  pause
  exit /b 1
)

:run
if defined OPEN start "" /b powershell -NoProfile -Command "for($i=0;$i -lt 60;$i++){try{Invoke-WebRequest -UseBasicParsing -Uri '%URL%/api/doctor' -TimeoutSec 2 | Out-Null; Start-Process '%URL%'; break}catch{Start-Sleep -Milliseconds 500}}"
echo My Office is starting at %URL%  (close this window or press Ctrl+C to stop)
node server\index.mjs
if errorlevel 1 (
  echo.
  echo The office stopped with an error, see the messages above.
  pause
)
endlocal
