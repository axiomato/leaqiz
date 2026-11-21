#!/bin/bash
# leaqiz per Doppelklick starten (macOS)
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "Node.js fehlt auf diesem Mac."
  echo "Bitte die LTS-Version von https://nodejs.org installieren"
  echo "und danach diese Datei erneut per Doppelklick starten."
  read -n1 -r -p "Taste drücken zum Schließen …"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Einmalige Einrichtung: lade benötigte Bausteine …"
  if ! npm install --omit=dev --no-audit --no-fund; then
    echo "Einrichtung fehlgeschlagen. Bitte Internetverbindung prüfen."
    read -n1 -r -p "Taste drücken zum Schließen …"
    exit 1
  fi
fi

OPEN_BROWSER=1 node server.js
