@echo off
title Zhuldyz site - close this window to stop the site
cd /d "%~dp0"
call "%~dp0stop-site.bat" nopause >nul
powershell -NoProfile -Command "$built = Get-Item -LiteralPath 'dist\index.html' -ErrorAction SilentlyContinue; if (-not $built) { exit 1 }; $sources = @(Get-ChildItem 'frontend\src', 'frontend\public', 'shared' -Recurse -File -ErrorAction SilentlyContinue) + @(Get-ChildItem 'frontend\*.html', 'frontend\vite.config.js', 'frontend\package*.json' -File -ErrorAction SilentlyContinue); if ($sources | Where-Object { $_.LastWriteTime -gt $built.LastWriteTime }) { exit 1 }; exit 0"
if errorlevel 1 (
  echo   Building the site...
  call "%~dp0build-site.bat" nopause
  if errorlevel 1 echo   Build failed - the site may show the previous version.
)
set "OPEN_FLAG="
set "RESTARTS=0"
:run
"%~dp0.tools\node\node.exe" "%~dp0server\index.js" %OPEN_FLAG%
rem Exit code 1 is a crash soon after start: restart without opening another browser tab, give up after 5 in a row.
rem Code 4 is a crash after a long healthy run: restart and forget the earlier crashes. Code 2: port busy or already running.
if "%errorlevel%"=="4" (
  set "RESTARTS=0"
  goto restart
)
if not "%errorlevel%"=="1" goto done
set /a RESTARTS+=1
if %RESTARTS% GEQ 5 goto crashed
:restart
echo   The server stopped unexpectedly - restarting in 3 seconds...
set "OPEN_FLAG=--no-browser"
timeout /t 3 >nul
goto run
:crashed
echo   The server keeps crashing. Details are in server-log.txt
:done
pause
