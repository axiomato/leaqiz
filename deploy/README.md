# leaqizz auf dem eigenen Server

Stand: 22.11.2026, Phase 1 im Aufbau. Ziel: Hetzner Cloud (D-43). Bis die Anmeldung für Lehrkräfte fertig ist, nimmt ein öffentlich erreichbarer Server **keine Live-Spiele an**. Das ist Absicht: Spiele ohne Konto sind nur lokal erlaubt (`LEAQIZ_SPIELE_OHNE_ANMELDUNG`).

## Was läuft

| Dienst | Aufgabe |
|---|---|
| `caddy` | HTTPS mit automatischem Zertifikat, leitet alles an `app` weiter (auch WebSocket) |
| `app` | Spielserver: liefert die Seiten aus `public/`, führt Live-Spiele über `/ws`, API unter `/api/` |
| `db` | PostgreSQL 17, Spielstände (überstehen einen Neustart) |

Gemessen (lokal, 2 Kerne, Testclients im selben Rechner): 100 gleichzeitige Spiele mit je 30 Handys, Antwortzeit im Median unter 1 ms, 95 % unter 13 ms, Server-Spitze 150 MB Speicher und 12 % eines Kerns (`npm run lasttest` in `server/`).

## Einmalig einrichten

1. **Server bestellen** (Hetzner Cloud Console): Ubuntu 24.04, SSH-Schlüssel hinterlegen, IPv4 und IPv6. Größe siehe Entscheidung D-43.
2. **Firewall** in der Hetzner Console: eingehend nur 22/tcp, 80/tcp, 443/tcp, 443/udp.
3. **DNS**: A- und AAAA-Eintrag der Domain auf den Server; `www` ebenfalls (wird umgeleitet).
4. **Docker** installieren (offizielle Anleitung für Ubuntu: docs.docker.com/engine/install/ubuntu).
5. **Code holen und starten**:
   ```sh
   git clone https://github.com/axiomato/leaqiz.git && cd leaqiz/deploy
   cp .env.example .env && nano .env          # DOMAIN, POSTGRES_PASSWORD
   VERSION=$(git rev-parse --short HEAD) docker compose up -d --build
   curl https://leaqizz.com/api/health        # {"ok":true,"database":true,…}
   ```

## Aktualisieren

```sh
cd leaqiz && git pull && cd deploy
VERSION=$(git rev-parse --short HEAD) docker compose up -d --build
```

Laufende Spiele überstehen das: Der Server sichert beim Herunterfahren alle Spielstände, Leinwand und Handys verbinden sich danach von selbst neu.

## Noch offen (Phase 1)

- Anmeldung für Lehrkräfte (Better Auth), Mailversand für Anmeldelinks
- Sicherung der Datenbank außer Haus (restic), Überwachung, Logrotation auf 7 Tage
- Datenschutzerklärung für den Serverbetrieb

## Einstellungen (Umgebungsvariablen des Dienstes `app`)

| Variable | Bedeutung | Vorgabe |
|---|---|---|
| `DATABASE_URL` | PostgreSQL-Verbindung | Pflicht |
| `LEAQIZ_ORIGIN` | öffentliche Adresse, prüft die Herkunft von WebSocket-Verbindungen | Pflicht |
| `LEAQIZ_HINTER_PROXY` | `ja` hinter Caddy (Client-IP aus X-Forwarded-For) | nein |
| `LEAQIZ_INDEXIERBAR` | `ja` gibt Startseite, Lehrkräfte-Seite, Datenschutz und Impressum für Suchmaschinen frei | nein |
| `LEAQIZ_SPIEL_LEERLAUF_MIN` | Spiel ohne Leinwand und Aktivität endet nach … Minuten | 120 |
| `LEAQIZ_LOESCHFRIST_TAGE` | beendete Spiele samt Spielnamen und Antworten löschen nach … Tagen | 30 |
| `LEAQIZ_GRENZE_VERBINDUNGEN_MINUTE` | neue Verbindungen je IP und Minute (eine Schule teilt sich oft eine IP) | 300 |
| `LEAQIZ_GRENZE_FALSCHE_PIN_MINUTE` | falsche PINs je IP und Minute | 30 |
| `LEAQIZ_GRENZE_SPIELE_STUNDE` | neue Spiele je IP und Stunde | 60 |
