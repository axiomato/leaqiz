#!/usr/bin/env bash
# Prüfungen stehen in einfachen Anführungszeichen und laufen über eval
# shellcheck disable=SC2016,SC2034
# Prüft die Server-Skripte ohne Server: .env-Erzeugung und Aktualisierung samt Rückfall auf den
# vorherigen Stand. Docker wird durch einen Platzhalter ersetzt, das „GitHub“ ist ein lokales Repo.
# Aufruf: bash deploy/server/test.sh
set -euo pipefail

HIER=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
fehler=0
pruefe() { if eval "$2"; then echo "ok   $1"; else echo "FEHLER $1"; fehler=1; fi; }

export LEAQIZZ_ETC=$TMP/etc LEAQIZZ_DIR=$TMP/opt LEAQIZZ_WARTEN_S=5
mkdir -p "$LEAQIZZ_ETC"
cat > "$LEAQIZZ_ETC/einstellungen.env" <<'EOF'
DOMAIN=quiz.example
REPO=axiomato/leaqiz-quellcode
REPO_TOKEN=
SMTP_HOST=smtp.example
SMTP_USER=noreply@quiz.example
SMTP_PASS='geh$im #mit "leerzeichen"'
MAIL_FROM='leaqizz <noreply@quiz.example>'
EOF

# ---------- „GitHub“: lokales Repo mit Branch live ----------
git init -q -b main "$TMP/quelle"
git -C "$TMP/quelle" -c user.name=t -c user.email=t@t commit -q --allow-empty -m eins
git -C "$TMP/quelle" branch live
git clone -q "$TMP/quelle" "$LEAQIZZ_DIR"
mkdir -p "$LEAQIZZ_DIR/deploy"
cp "$HIER/../compose.yaml" "$HIER/../Caddyfile" "$LEAQIZZ_DIR/deploy/"
git -C "$LEAQIZZ_DIR" checkout -q --detach origin/live
neuer_stand() { git -C "$TMP/quelle" -c user.name=t -c user.email=t@t commit -q --allow-empty -m "$1" && git -C "$TMP/quelle" branch -f live main && git -C "$TMP/quelle" rev-parse main; }

# ---------- .env aus Einstellungen und Geheimnissen ----------
(
  # shellcheck source=/dev/null
  LEAQIZZ_NUR_FUNKTIONEN=1 . "$HIER/einrichten.sh"
  lade_einstellungen
  geheimnisse
  schreibe_env
)
pruefe "Geheimnisse angelegt, nur für root lesbar" '[[ $(stat -c %a "$LEAQIZZ_ETC/geheimnisse.env") == 600 ]]'
erstes=$(cat "$LEAQIZZ_ETC/geheimnisse.env")
# shellcheck source=/dev/null
( LEAQIZZ_NUR_FUNKTIONEN=1 . "$HIER/einrichten.sh"; lade_einstellungen; geheimnisse; schreibe_env )
pruefe "Geheimnisse bleiben bei erneutem Lauf gleich" '[[ $(cat "$LEAQIZZ_ETC/geheimnisse.env") == "$erstes" ]]'
pruefe ".env enthält Domain und Mail" 'grep -q "^DOMAIN='"'"'quiz.example'"'"'$" "$LEAQIZZ_DIR/deploy/.env" && grep -q "^SMTP_HOST='"'"'smtp.example'"'"'$" "$LEAQIZZ_DIR/deploy/.env"'
if command -v docker > /dev/null && docker compose version > /dev/null 2>&1; then
  pruefe "Docker Compose akzeptiert die erzeugte .env" 'docker compose -f "$LEAQIZZ_DIR/deploy/compose.yaml" --env-file "$LEAQIZZ_DIR/deploy/.env" config -q'
  pass=$(docker compose -f "$LEAQIZZ_DIR/deploy/compose.yaml" --env-file "$LEAQIZZ_DIR/deploy/.env" config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["app"]["environment"]["SMTP_PASS"])')
  # „config“ gibt $ als $$ aus (Schreibweise für ein wörtliches $ in Compose-Dateien)
  pruefe "Passwort mit Sonderzeichen kommt unverändert an" '[[ $pass == "geh\$\$im #mit \"leerzeichen\"" ]]'
fi

# ---------- Aktualisieren mit Platzhalter für docker ----------
mkdir -p "$TMP/bin"
cat > "$TMP/bin/docker" <<'EOF'
#!/usr/bin/env bash
# Platzhalter: „up“ wird protokolliert; der Stand in $SCHLECHT wird nie gesund
case "$*" in
  *" up "*) echo "up $(git -C "$LEAQIZZ_DIR" rev-parse --short HEAD)" >> "$PROTOKOLL" ;;
  *" ps -q app"*) echo cid ;;
  inspect*) if [[ $(git -C "$LEAQIZZ_DIR" rev-parse HEAD) == "${SCHLECHT:-}" ]]; then echo unhealthy; else echo healthy; fi ;;
esac
EOF
chmod +x "$TMP/bin/docker"
export PATH=$TMP/bin:$PATH PROTOKOLL=$TMP/protokoll SCHLECHT=
: > "$PROTOKOLL"
lauf() { bash "$HIER/aktualisieren.sh" "$@" > "$TMP/ausgabe" 2>&1; }

lauf; pruefe "Ohne neuen Stand: nichts tun" '[[ ! -s $PROTOKOLL ]]'

gut=$(neuer_stand zwei)
lauf; pruefe "Neuer Stand wird gestartet" '[[ $(git -C "$LEAQIZZ_DIR" rev-parse HEAD) == "$gut" ]] && grep -q "up ${gut:0:7}" "$PROTOKOLL"'

export SCHLECHT; SCHLECHT=$(neuer_stand drei)
lauf && rc=0 || rc=$?
pruefe "Kranker Stand: Rückfall auf den vorherigen, Fehlercode" '[[ $rc -ne 0 && $(git -C "$LEAQIZZ_DIR" rev-parse HEAD) == "$gut" ]]'
pruefe "Kranker Stand wird gemerkt" '[[ $(cat "$LEAQIZZ_ETC/fehlgeschlagen") == "$SCHLECHT" ]]'
: > "$PROTOKOLL"
lauf; pruefe "Gemerkter kranker Stand wird nicht alle 10 Minuten neu versucht" '[[ ! -s $PROTOKOLL ]]'

repariert=$(neuer_stand vier)
lauf; pruefe "Nächster gesunder Stand läuft, Merker gelöscht" '[[ $(git -C "$LEAQIZZ_DIR" rev-parse HEAD) == "$repariert" && ! -e $LEAQIZZ_ETC/fehlgeschlagen ]]'
: > "$PROTOKOLL"
lauf --erzwingen; pruefe "--erzwingen startet auch ohne neuen Stand" '[[ -s $PROTOKOLL ]]'

exit $fehler
