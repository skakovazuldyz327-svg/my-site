@echo off
rem Starts PostgreSQL in Docker for start-site.bat and restore-backup.bat. Opens Docker Desktop when it is not running
rem and waits up to 3 minutes for the database container; exit code 1 when it never came up.
cd /d "%~dp0"
where docker >nul 2>&1
if errorlevel 1 (
  echo   Docker is not installed - the site keeps its data in PostgreSQL in Docker, install Docker Desktop.
  exit /b 1
)
echo   Starting the database (PostgreSQL in Docker)...
docker compose up -d postgres >nul 2>&1
if not errorlevel 1 exit /b 0
if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" (
  echo   Starting Docker Desktop...
  start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
)
set "TRIES=0"
:again
timeout /t 5 >nul
docker compose up -d postgres >nul 2>&1
if not errorlevel 1 exit /b 0
set /a TRIES+=1
if %TRIES% GEQ 36 (
  echo   Docker did not start the database - open Docker Desktop and try again.
  exit /b 1
)
goto again
