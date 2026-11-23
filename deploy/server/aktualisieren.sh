#!/usr/bin/env bash
# leaqizz: neuen Stand holen und starten. Läuft alle 10 Minuten (leaqizz-aktualisieren.timer).
# Folgt dem Branch "live": Den setzt GitHub Actions nur auf Stände, deren Tests grün sind.
# Wird der neue Stand nicht gesund, geht der Server auf den vorherigen zurück.
#   leaqizz-aktualisieren               nur wenn es einen neuen Stand gibt
#   leaqizz-aktualisieren --erzwingen   immer neu bauen und starten (z. B. nach neuen Einstellungen)
set -euo pipefail

main() {
  local ETC=${LEAQIZZ_ETC:-/etc/leaqizz}
  local DIR=${LEAQIZZ_DIR:-/opt/leaqizz}
  local WARTEN=${LEAQIZZ_WARTEN_S:-180}
  local erzwingen=0
  [[ ${1:-} == --erzwingen ]] && erzwingen=1

  log() { printf 'leaqizz-aktualisieren: %s\n' "$*"; }

  set -a
  # shellcheck source=/dev/null
  . "$ETC/einstellungen.env"
  set +a
  local branch=${BRANCH:-live}

  local auth=()
  if [[ -n ${REPO_TOKEN:-} ]]; then
    auth=(-c "http.extraHeader=Authorization: Basic $(printf 'x-access-token:%s' "$REPO_TOKEN" | base64 -w0)")
  fi

  cd "$DIR"
  if ! git "${auth[@]}" fetch --quiet origin "+refs/heads/$branch:refs/remotes/origin/$branch"; then
    log "Branch $branch nicht abrufbar (GitHub Actions legt ihn nach dem ersten grünen Lauf an; Token gültig?)"
    exit 1
  fi
  local alt neu fehler=$ETC/fehlgeschlagen
  alt=$(git rev-parse HEAD)
  neu=$(git rev-parse "origin/$branch")
  if [[ $alt == "$neu" && $erzwingen -eq 0 ]]; then
    exit 0
  fi
  # Ein Stand, der schon einmal nicht gesund wurde, wird nicht alle 10 Minuten neu versucht
  if [[ $erzwingen -eq 0 && -r $fehler && $(cat "$fehler") == "$neu" ]]; then
    exit 0
  fi

  # Im if-Zweig gilt set -e nicht: Fehler deshalb ausdrücklich weitergeben
  starte() {
    git checkout --quiet --force --detach "$1" || return 1
    VERSION=$(git rev-parse --short HEAD) docker compose --project-name leaqizz -f deploy/compose.yaml --env-file deploy/.env up -d --build --remove-orphans || return 1
  }

  gesund() {
    local id status i
    for ((i = 0; i < WARTEN; i += 5)); do
      id=$(docker compose --project-name leaqizz -f deploy/compose.yaml --env-file deploy/.env ps -q app)
      status=$(docker inspect --format '{{.State.Health.Status}}' "$id" 2>/dev/null || echo fehlt)
      [[ $status == healthy ]] && return 0
      sleep 5
    done
    return 1
  }

  log "Starte ${neu:0:7} (vorher ${alt:0:7})"
  if starte "$neu" && gesund; then
    log "Läuft: ${neu:0:7}"
    rm -f "$fehler"
    docker image prune -f > /dev/null
    exit 0
  fi
  log "Neuer Stand ${neu:0:7} ist nicht gesund"
  printf '%s\n' "$neu" > "$fehler"
  if [[ $alt != "$neu" ]]; then
    log "Zurück auf ${alt:0:7}"
    if starte "$alt" && gesund; then
      log "Wieder auf ${alt:0:7}"
    else
      log "Auch ${alt:0:7} startet nicht: bitte prüfen (journalctl -u leaqizz-aktualisieren)"
    fi
  fi
  exit 1
}

# Als Funktion, damit ein git checkout, der diese Datei ändert, den laufenden Aufruf nicht stört
main "$@"
# shellcheck disable=SC2317 # Schutz: nach main nichts weiter aus der (vielleicht geänderten) Datei lesen
exit $?
