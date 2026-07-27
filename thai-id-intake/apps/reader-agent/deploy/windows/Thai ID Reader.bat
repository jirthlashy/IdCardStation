@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0.reader-support\THAI_ID_READER_LAUNCHER.ps1" (
  echo Missing reader support files.
  echo Please re-copy the full reader-agent folder.
  pause
  exit /b 1
)
if exist "%~dp0.reader-support\INSTALL_READER.ps1" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0.reader-support\INSTALL_READER.ps1"
  if errorlevel 1 goto failed
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0.reader-support\THAI_ID_READER_LAUNCHER.ps1"
if errorlevel 1 goto failed
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0.reader-support\RUN_READER_AGENT_BACKGROUND.ps1"
echo.
echo Reader-agent stopped or exited.
pause
exit /b 0

:failed
echo.
echo Thai ID Reader did not start. Review the PowerShell error above.
echo Correct the reported problem, then double-click Thai ID Reader.bat again.
pause
exit /b 1
