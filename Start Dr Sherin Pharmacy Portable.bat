@echo off
cd /d "%~dp0"
if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" scripts\start-local-system.mjs
) else (
  echo Missing bundled runtime\node.exe
  echo Use the normal launcher or create the Windows portable package first.
  pause
  exit /b 1
)
pause
