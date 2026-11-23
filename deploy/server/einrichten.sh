#!/usr/bin/env bash
# leaqizz: Server einrichten (Ubuntu 24.04, als root). Beliebig oft ausführbar.
# Läuft beim ersten Start über cloud-init (deploy/cloud-init.yaml), danach von Hand nach
# Änderungen an /etc/leaqizz/einstellungen.env:  leaqizz-einrichten
#
# Richtet ein: Docker, Firewall (nur 22, 80, 443), automatische Sicherheitsupdates mit Neustart
# um 04:30, Logs höchstens 7 Tage (journald), Swap bei wenig Speicher, SSH nur mit Schlüssel,
# Sperre des Metadaten-Dienstes für Container, Aktualisierung alle 10 Minuten (nur grüne Stände).
set -euo pipefail

ETC=${LEAQIZZ_ETC:-/etc/leaqizz}
DIR=${LEAQIZZ_DIR:-/opt/leaqizz}
EINSTELLUNGEN=$ETC/einstellungen.env
GEHEIMNISSE=$ETC/geheimnisse.env

log() { printf 'leaqizz-einrichten: %s\n' "$*"; }

# ---------- Einstellungen und Geheimnisse ----------

lade_einstellungen() {
  [[ -r $EINSTELLUNGEN ]] || { log "Fehlt: $EINSTELLUNGEN (Vorlage: deploy/cloud-init.yaml)"; exit 1; }
  set -a
  # shellcheck source=/dev/null
  . "$EINSTELLUNGEN"
  set +a
  : "${DOMAIN:?DOMAIN fehlt in $EINSTELLUNGEN}"
  : "${REPO:?REPO fehlt in $EINSTELLUNGEN}"
}

# Einmal erzeugt, danach unverändert (ein neuer Sitzungsschlüssel würde alle abmelden)
geheimnisse() {
  install -d -m 700 "$ETC"
  if [[ ! -s $GEHEIMNISSE ]]; then
    umask 077
    {
      printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 24)"
      printf 'BETTER_AUTH_SECRET=%s\n' "$(openssl rand -base64 48 | tr -d '\n')"
    } > "$GEHEIMNISSE"
    log "Geheimnisse erzeugt: $GEHEIMNISSE"
  fi
  # shellcheck source=/dev/null
  . "$GEHEIMNISSE"
}

# Wert in einfachen Anführungszeichen: Docker Compose übernimmt ihn dann wörtlich ($, #, Leerzeichen)
wert() {
  if [[ $2 == *"'"* ]]; then
    log "$1 darf kein einfaches Anführungszeichen (') enthalten."
    exit 1
  fi
  printf "%s='%s'\n" "$1" "$2"
}

# deploy/.env für Docker Compose aus Einstellungen und Geheimnissen
schreibe_env() {
  local ziel=$DIR/deploy/.env
  umask 077
  {
    printf '# Erzeugt von leaqizz-einrichten. Nicht hier ändern, sondern in %s.\n' "$EINSTELLUNGEN"
    wert DOMAIN "$DOMAIN"
    wert POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
    wert BETTER_AUTH_SECRET "$BETTER_AUTH_SECRET"
    wert SMTP_HOST "${SMTP_HOST:-}"
    wert SMTP_PORT "${SMTP_PORT:-587}"
    wert SMTP_USER "${SMTP_USER:-}"
    wert SMTP_PASS "${SMTP_PASS:-}"
    wert MAIL_FROM "${MAIL_FROM:-leaqizz <noreply@$DOMAIN>}"
    wert LEAQIZ_INDEXIERBAR "${LEAQIZ_INDEXIERBAR:-nein}"
    wert LEAQIZ_ABO "${LEAQIZ_ABO:-nein}"
    wert LEAQIZ_ZAHLUNG "${LEAQIZ_ZAHLUNG:-}"
    wert LEAQIZ_BETREIBER_MAIL "${LEAQIZ_BETREIBER_MAIL:-}"
    wert PAYPAL_UMGEBUNG "${PAYPAL_UMGEBUNG:-sandbox}"
    wert PAYPAL_CLIENT_ID "${PAYPAL_CLIENT_ID:-}"
    wert PAYPAL_CLIENT_SECRET "${PAYPAL_CLIENT_SECRET:-}"
    wert PAYPAL_WEBHOOK_ID "${PAYPAL_WEBHOOK_ID:-}"
    wert PAYPAL_PLAN_ID "${PAYPAL_PLAN_ID:-}"
  } > "$ziel"
}

mail_fehlt() { [[ -z ${SMTP_HOST:-} || -z ${SMTP_USER:-} || -z ${SMTP_PASS:-} ]]; }

# ---------- Code holen ----------

# Token nur als Kopfzeile, nicht in .git/config
git_auth() {
  if [[ -n ${REPO_TOKEN:-} ]]; then
    printf -- '-c\nhttp.extraHeader=Authorization: Basic %s\n' "$(printf 'x-access-token:%s' "$REPO_TOKEN" | base64 -w0)"
  fi
}

hole_code() {
  if [[ -d $DIR/.git ]]; then return; fi
  log "Code holen: $REPO"
  local args=()
  mapfile -t args < <(git_auth)
  git "${args[@]}" clone --quiet "https://github.com/$REPO.git" "$DIR"
}

# ---------- System ----------

pakete() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get install -y -q docker.io docker-compose-v2 git ufw unattended-upgrades openssl curl
  systemctl enable --now docker
}

updates() {
  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
  cat > /etc/apt/apt.conf.d/52leaqizz-upgrades <<'EOF'
// Sicherheitsupdates nachts einspielen; Neustart nur wenn nötig, nachts (Spiele überstehen ihn)
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
}

logs() {
  # Server-Logs mit IP-Adressen höchstens 7 Tage (Architektur, Löschfristen)
  install -d /etc/systemd/journald.conf.d
  cat > /etc/systemd/journald.conf.d/leaqizz.conf <<'EOF'
[Journal]
MaxRetentionSec=7day
SystemMaxUse=500M
EOF
  systemctl restart systemd-journald
  install -d /etc/docker
  cat > /etc/docker/daemon.json <<'EOF'
{ "log-driver": "journald" }
EOF
  systemctl restart docker
}

swap() {
  local mem_kb
  mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
  if (( mem_kb < 3000000 )) && ! swapon --show | grep -q .; then
    log "Swap anlegen (2 GB)"
    fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
}

ssh_haerten() {
  # Nur wenn ein Schlüssel hinterlegt ist, sonst sperrt man sich aus
  if [[ -s /root/.ssh/authorized_keys ]]; then
    cat > /etc/ssh/sshd_config.d/50-leaqizz.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
    systemctl reload ssh || systemctl reload sshd || true
  else
    log "Kein SSH-Schlüssel für root hinterlegt: SSH-Passwortanmeldung bleibt an. Schlüssel hinterlegen und erneut ausführen."
  fi
}

firewall() {
  ufw --force default deny incoming
  ufw --force default allow outgoing
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 443/udp
  ufw --force enable
}

dienste() {
  install -m 755 "$DIR/deploy/server/einrichten.sh" /usr/local/bin/leaqizz-einrichten
  install -m 755 "$DIR/deploy/server/aktualisieren.sh" /usr/local/bin/leaqizz-aktualisieren
  install -m 644 "$DIR"/deploy/server/systemd/*.service "$DIR"/deploy/server/systemd/*.timer /etc/systemd/system/
  systemctl daemon-reload
  # Container dürfen den Metadaten-Dienst nicht erreichen (dort liegt die cloud-init-Konfiguration)
  systemctl enable --now leaqizz-metadaten-sperre.service
  systemctl enable --now leaqizz-aktualisieren.timer
}

# ---------- Ablauf ----------

main() {
  [[ $(id -u) -eq 0 ]] || { log "Bitte als root ausführen."; exit 1; }
  lade_einstellungen
  pakete
  updates
  logs
  swap
  ssh_haerten
  firewall
  hole_code
  geheimnisse
  schreibe_env
  dienste
  if mail_fehlt; then
    log "SMTP fehlt in $EINSTELLUNGEN: leaqizz startet erst mit Mailversand. Eintragen, dann: leaqizz-einrichten"
    exit 0
  fi
  /usr/local/bin/leaqizz-aktualisieren --erzwingen
  log "Fertig. Prüfen: https://$DOMAIN/api/health"
}

# Nur Funktionen laden (Tests)
if [[ ${LEAQIZZ_NUR_FUNKTIONEN:-} != 1 ]]; then
  main "$@"
  exit $?
fi
