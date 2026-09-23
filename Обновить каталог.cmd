@echo off
chcp 65001 >nul
where pwsh.exe >nul 2>&1
if errorlevel 1 (
  echo Для обновления каталога требуется PowerShell 7 ^(pwsh.exe^).
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0extract-offer-areas.ps1"
if errorlevel 1 (
  echo.
  echo Не удалось распознать площади офферов.
  pause
  exit /b 1
)
pwsh.exe -NoProfile -File "%~dp0sync-scout-data.ps1"
if errorlevel 1 (
  echo.
  echo Не удалось обновить каталог.
  pause
  exit /b 1
)
echo.
echo Готово. Обновите страницу каталога в браузере.
pause
