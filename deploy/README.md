# leaqizz auf dem eigenen Server

Stand: 22.11.2026, Phase 1 im Aufbau. Ziel: Hetzner Cloud (D-43), Ersatz netcup. Live-Spiele starten nur angemeldete Lehrkräfte (Anmeldelink per Mail oder Passkey). Ohne funktionierenden Mailversand startet der Server nicht.

## Was läuft

| Dienst | Aufgabe |
|---|---|
| `caddy` | HTTPS mit automatischem Zertifikat, leitet alles an `app` weiter (auch WebSocket) |
| `app` | Spielserver: liefert die Seiten aus `public/`, führt Live-Spiele über `/ws`, API unter `/api/`, Anmeldung unter `/api/auth/` |
| `db` | PostgreSQL 17, Spielstände (überstehen einen Neustart) |

Gemessen (lokal, 2 Kerne, Testclients im selben Rechner): 100 gleichzeitige Spiele mit je 30 Handys, Antwortzeit im Median unter 1 ms, 95 % unter 13 ms, Server-Spitze 150 MB Speicher und 12 % eines Kerns (`npm run lasttest` in `server/`).

## Einmalig einrichten

1. **Server bestellen** (Hetzner Cloud Console): Ubuntu 24.04, SSH-Schlüssel hinterlegen, IPv4 und IPv6. Größe siehe Entscheidung D-43.
2. **Firewall** in der Hetzner Console: eingehend nur 22/tcp, 80/tcp, 443/tcp, 443/udp.
   **AV-Vertrag** im Hetzner-Kundenkonto abschließen (Konto → Datenschutz).
3. **Mail**: Hetzner Webhosting S, Postfach `noreply@…` anlegen, DKIM aktivieren, SPF und DMARC setzen (konsoleH). Zugangsdaten in `deploy/.env`.
4. **DNS**: A- und AAAA-Eintrag der Domain auf den Server; `www` ebenfalls (wird umgeleitet).
5. **Docker** installieren (offizielle Anleitung für Ubuntu: docs.docker.com/engine/install/ubuntu).
6. **Code holen und starten**:
   ```sh
   git clone https://github.com/axiomato/leaqiz.git && cd leaqiz/deploy
   cp .env.example .env && nano .env          # DOMAIN, POSTGRES_PASSWORD, BETTER_AUTH_SECRET, SMTP_*
   VERSION=$(git rev-parse --short HEAD) docker compose up -d --build
   curl https://leaqizz.com/api/health        # {"ok":true,"database":true,…}
   ```
7. **Prüfen**: `https://leaqizz.com/host/` → Anmelden → Link kommt per Mail (auch Spam-Ordner prüfen) → Passkey einrichten → Live-Spiel starten.

## Aktualisieren

```sh
cd leaqiz && git pull && cd deploy
VERSION=$(git rev-parse --short HEAD) docker compose up -d --build
```

Laufende Spiele überstehen das: Der Server sichert beim Herunterfahren alle Spielstände, Leinwand und Handys verbinden sich danach von selbst neu.

## Noch offen (Phase 1)

- Konto löschen in der Oberfläche (die Datenbank löscht Spiele und Quizze mit dem Konto schon mit)
- Sicherung der Datenbank außer Haus (restic), Überwachung, Logrotation auf 7 Tage
- Datenschutzerklärung für den Serverbetrieb

## Einstellungen (Umgebungsvariablen des Dienstes `app`)

| Variable | Bedeutung | Vorgabe |
|---|---|---|
| `DATABASE_URL` | PostgreSQL-Verbindung | Pflicht |
| `LEAQIZ_ORIGIN` | öffentliche Adresse, prüft die Herkunft von WebSocket-Verbindungen | Pflicht |
| `LEAQIZ_HINTER_PROXY` | `ja` hinter Caddy (Client-IP aus X-Forwarded-For) | nein |
| `LEAQIZ_INDEXIERBAR` | `ja` gibt Startseite, Lehrkräfte-Seite, Datenschutz und Impressum für Suchmaschinen frei | nein |
| `BETTER_AUTH_SECRET` | Schlüssel für Anmeldesitzungen (mind. 32 Zeichen); ändern meldet alle ab | Pflicht |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Mailversand der Anmeldelinks | Pflicht (lokal ohne: Links im Log) |
| `LEAQIZ_SPIEL_LEERLAUF_MIN` | Spiel ohne Leinwand und Aktivität endet nach … Minuten | 120 |
| `LEAQIZ_LOESCHFRIST_TAGE` | beendete Spiele samt Spielnamen und Antworten löschen nach … Tagen | 30 |
| `LEAQIZ_GRENZE_VERBINDUNGEN_MINUTE` | neue Verbindungen je IP und Minute (eine Schule teilt sich oft eine IP) | 300 |
| `LEAQIZ_GRENZE_FALSCHE_PIN_MINUTE` | falsche PINs je IP und Minute | 30 |
| `LEAQIZ_GRENZE_SPIELE_STUNDE` | neue Spiele je IP und Stunde | 60 |

## Privates Code-Repo, öffentliches Seiten-Repo

Der Quellcode liegt privat in `axiomato/leaqiz-quellcode`. Öffentlich ist nur die fertige Website in
`axiomato/leaqiz`; die Adresse `https://axiomato.github.io/leaqiz/` bleibt gleich. Der Workflow schiebt nach
jedem grünen Lauf auf `main` den Ordner `public/` samt README (`deploy/site/README.md`) und LICENSE hinüber
(Job `publish`). Solange die Variable `SITE_REPO` fehlt, veröffentlicht er wie bisher über Pages dieses Repos.

Einmalig, in dieser Reihenfolge (die Website ist zwischen Schritt 2 und 7 ein paar Minuten nicht erreichbar):

1. `axiomato/leaqiz` → Settings → General → Repository name: `leaqiz-quellcode` → Rename.
2. Ganz unten, Danger Zone → Change repository visibility → Private. GitHub Free nimmt die Pages-Seite dabei
   automatisch vom Netz. Bestehende Forks bleiben öffentlich und werden abgetrennt.
3. Neues Repository `leaqiz` anlegen: Public, ohne README, ohne .gitignore, ohne Lizenz.
4. Token anlegen: Profilbild → Settings → Developer settings → Personal access tokens → Fine-grained tokens →
   Generate new token. Name `leaqiz-veroeffentlichen`, Ablauf nach Wahl (bei Ablauf wird der Job rot, die
   Website bleibt stehen), Repository access: Only select repositories → `axiomato/leaqiz`,
   Permissions → Repository → Contents: Read and write. Token kopieren.
5. In `leaqiz-quellcode` → Settings → Secrets and variables → Actions:
   Tab Secrets → New repository secret `SITE_TOKEN` (der Token);
   Tab Variables → New repository variable `SITE_REPO` = `axiomato/leaqiz`.
6. `leaqiz-quellcode` → Actions → „Tests und GitHub Pages“ → Run workflow (Branch `main`).
   Der Job `publish` füllt das neue Repo.
7. In `leaqiz` → Settings → Pages → Source: Deploy from a branch → `main` / `(root)` → Save.

Kosten: In privaten Repos zählen die Minuten von GitHub Actions; ein Lauf braucht etwa 3 Minuten
(GitHub Free: 2.000 Minuten im Monat). Die Auslieferung im öffentlichen Repo kostet nichts.

Achtung für lokale Klone: Nach Schritt 3 zeigt die alte Adresse `github.com/axiomato/leaqiz` auf das
öffentliche Seiten-Repo. Vor dem nächsten Push die Adresse umstellen:
`git remote set-url origin https://github.com/axiomato/leaqiz-quellcode.git`
