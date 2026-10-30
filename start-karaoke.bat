@echo off
rem Double-clic : lance tous les serveurs du karaoké (ceux déjà démarrés sont ignorés). Voir start-karaoke.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-karaoke.ps1" %*
echo.
pause
