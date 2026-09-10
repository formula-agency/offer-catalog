@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0generate-offers-data.ps1"
if errorlevel 1 (
  echo.
  echo Не удалось обновить каталог.
  pause
  exit /b 1
)
echo.
echo Готово. Обновите страницу каталога в браузере.
pause
