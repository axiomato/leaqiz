@echo off
title leaqiz
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js fehlt auf diesem Rechner.
  echo Bitte die LTS-Version von https://nodejs.org installieren
  echo und danach diese Datei erneut per Doppelklick starten.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Einmalige Einrichtung: lade benoetigte Bausteine ...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo Einrichtung fehlgeschlagen. Bitte Internetverbindung pruefen.
    pause
    exit /b 1
  )
)

set OPEN_BROWSER=1
node server.js
pause
