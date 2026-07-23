@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0.reader-support\THAI_ID_READER_LAUNCHER.ps1" (
  echo Missing reader support files.
  echo Please re-copy the full reader-agent folder.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0.reader-support\THAI_ID_READER_LAUNCHER.ps1"
if errorlevel 1 goto done
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0.reader-support\RUN_READER_AGENT_BACKGROUND.ps1"
echo.
echo Reader-agent stopped or exited.
pause

:done
endlocal
