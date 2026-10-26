@echo off
title Zhuldyz site - restore the database from a daily copy
cd /d "%~dp0"
call "%~dp0stop-site.bat" nopause
"%~dp0.tools\node\node.exe" "%~dp0server\restore.js"
pause
