@echo off
cd /d "%~dp0frontend"
set "PATH=%~dp0.tools\node;%PATH%"
if not exist node_modules call npm install
call npm run build
set "BUILD_RESULT=%errorlevel%"
if not "%~1"=="nopause" pause
exit /b %BUILD_RESULT%
