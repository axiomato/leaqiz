#!/usr/bin/env bash
# Stellt zusammen, was GitHub Pages ausliefert (Jobs „deploy“ und „publish“ in .github/workflows/pages.yml):
# bis zum Start die Website aus public/, danach nur die Weiterleitung auf die eigene Domain (D-61).
#
#   PAGES_ZIEL=https://leaqizz.com SHA=abc1234 deploy/site/zusammenstellen.sh <ausgabeordner>
#
# PAGES_ZIEL leer → Website (mit Versionsnummer SHA an CSS/JS); gesetzt → Weiterleitung dorthin.
set -euo pipefail

out="${1:?Ausgabeordner fehlt}"
here="$(cd "$(dirname "$0")/../.." && pwd)"
rm -rf "$out"
mkdir -p "$out"

if [ -n "${PAGES_ZIEL:-}" ]; then
  if ! [[ "$PAGES_ZIEL" =~ ^https://[a-z0-9.-]+$ ]]; then
    echo "::error::PAGES_ZIEL muss so aussehen: https://leaqizz.com (ohne Pfad, ohne Schrägstrich am Ende)" >&2
    exit 1
  fi
  for f in index.html 404.html; do
    sed "s#__ZIEL__#${PAGES_ZIEL}#g" "$here/deploy/weiterleitung/$f" > "$out/$f"
  done
  echo "GitHub Pages leitet weiter nach $PAGES_ZIEL"
else
  cp -a "$here/public/." "$out/"
  # Versionsnummer an CSS/JS hängen, damit Browser nach jedem Deploy die neuen Dateien laden
  find "$out" -name '*.html' -exec sed -i "s/?v=dev/?v=${SHA:-dev}/g" {} +
fi
