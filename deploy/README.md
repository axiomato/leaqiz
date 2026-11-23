# leaqizz auf dem eigenen Server

Stand: 23.11.2026, Phase 1 im Aufbau. Ziel: Hetzner Cloud (D-43), Ersatz netcup. Live-Spiele starten nur angemeldete Lehrkräfte (Anmeldelink per Mail oder Passkey). Ohne funktionierenden Mailversand startet der Server nicht.

## Was läuft

| Dienst | Aufgabe |
|---|---|
| `caddy` | HTTPS mit automatischem Zertifikat, leitet alles an `app` weiter (auch WebSocket) |
| `app` | Spielserver: liefert die Seiten aus `public/`, führt Live-Spiele über `/ws`, API unter `/api/`, Anmeldung unter `/api/auth/` |
| `db` | PostgreSQL 17: Konten, Quizze, Spielstände (überstehen einen Neustart) |

Gemessen (lokal, 2 Kerne, Testclients im selben Rechner): 100 gleichzeitige Spiele mit je 30 Handys, Antwortzeit im Median unter 1 ms, 95 % unter 13 ms, Server-Spitze 150 MB Speicher und 12 % eines Kerns (`npm run lasttest` in `server/`).

## Einmalig einrichten

Alles Weitere erledigt der Server beim ersten Start selbst (`deploy/cloud-init.yaml` → `deploy/server/einrichten.sh`):
Docker, Firewall (nur 22, 80, 443), automatische Sicherheitsupdates mit Neustart um 04:30 wenn nötig,
Logs höchstens 7 Tage, Swap bei wenig Speicher, SSH nur mit Schlüssel, Container ohne Zugriff auf den
Metadaten-Dienst, Code holen und starten.

1. **Domain und Mail:** leaqizz.com registrieren; Hetzner Webhosting S mit Postfach `noreply@…`, DKIM, SPF und DMARC (D-44).
2. **Token** (nur nach der Repo-Aufteilung): GitHub → Settings → Developer settings → Fine-grained tokens → Generate.
   Nur Repository `axiomato/leaqiz-quellcode`, Permissions → Contents: **Read-only**. Vorher (Repo öffentlich) kein Token
   und `REPO=axiomato/leaqiz`.
3. **AV-Vertrag** im Hetzner-Kundenkonto abschließen (`accounts.hetzner.com/account/dpa`).
4. **Server erstellen** (Hetzner Cloud Console): Ubuntu 24.04, Typ nach D-43, SSH-Schlüssel hinterlegen,
   Firewall mit eingehend 22/tcp, 80/tcp, 443/tcp, 443/udp. Unter **Cloud config** den Inhalt von
   `deploy/cloud-init.yaml` einfügen und dort nur den Block `einstellungen.env` ausfüllen (Domain, Repo, Token, SMTP).
5. **DNS:** A- und AAAA-Eintrag der Domain (und `www`) auf die Adressen des neuen Servers. Das Zertifikat holt
   Caddy von selbst, sobald der Eintrag gilt.
6. **Prüfen** nach etwa 10 Minuten: `https://leaqizz.com/api/health` → `{"ok":true,"database":true,…}`, dann
   `https://leaqizz.com/host/` → Anmelden → Link kommt per Mail (auch Spam-Ordner) → Passkey → Live-Spiel.

Einstellungen später ändern (SSH oder Konsole in der Hetzner Console):

```sh
nano /etc/leaqizz/einstellungen.env   # z. B. SMTP-Passwort, LEAQIZ_INDEXIERBAR=ja (D-46)
leaqizz-einrichten                    # übernimmt die Werte und startet neu
```

Die Geheimnisse (Datenbank-Passwort, Sitzungsschlüssel) erzeugt der Server einmal und legt sie in
`/etc/leaqizz/geheimnisse.env` ab. Nicht ändern: Ein neuer Sitzungsschlüssel meldet alle ab.

Wo was liegt: Code `/opt/leaqizz`, Einstellungen `/etc/leaqizz/`, Logs `journalctl -u leaqizz-aktualisieren`
und `docker compose -p leaqizz logs` (in `/opt/leaqizz/deploy`).

## Aktualisieren

Von selbst: GitHub Actions setzt den Branch `live` auf jeden Stand von `main`, dessen Tests grün sind. Der Server
sieht alle 10 Minuten nach (`leaqizz-aktualisieren.timer`), baut den neuen Stand und startet ihn. Wird er nicht
gesund, geht der Server auf den vorherigen Stand zurück und versucht den kranken nicht erneut. Sofort:

```sh
leaqizz-aktualisieren               # nur wenn es einen neuen Stand gibt
leaqizz-aktualisieren --erzwingen   # immer neu bauen und starten
```

Laufende Spiele überstehen das: Der Server sichert beim Herunterfahren alle Spielstände, Leinwand und Handys
verbinden sich danach von selbst neu (im Browser geprüft, D-47).

Geprüft ohne echten Server (`bash deploy/server/test.sh`, läuft in jedem CI-Lauf): Erzeugung der `.env`,
Sonderzeichen im Passwort, Aktualisierung, Rückfall auf den vorherigen Stand. **Nicht geprüft:** ein Lauf auf
einem echten Hetzner-Server (erst mit der Bestellung möglich).

## Noch offen (Phase 1)

- Sicherung der Datenbank außer Haus (restic; Ziel noch offen), Überwachung von außen
- Datenschutzerklärung prüfen lassen: Der Server zeigt unter `/datenschutz/` die Fassung für den
  Serverbetrieb (`server/seiten/datenschutz.html`, Entwurf), GitHub Pages weiter `public/datenschutz/`.
  Nach der Bestellung den Standort des Servers eintragen; sobald Sicherungen laufen, Ort und Frist ergänzen.

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
| `LEAQIZ_LOESCHFRIST_TAGE` | beendete Spiele und ihre Ergebnisse samt Spielnamen und Antworten löschen nach … Tagen (steht auch in der Datenschutzerklärung) | 30 |
| `LEAQIZ_GRENZE_VERBINDUNGEN_MINUTE` | neue Verbindungen je IP und Minute (eine Schule teilt sich oft eine IP) | 300 |
| `LEAQIZ_GRENZE_FALSCHE_PIN_MINUTE` | falsche PINs je IP und Minute | 30 |
| `LEAQIZ_GRENZE_SPIELE_STUNDE` | neue Spiele je IP und Stunde | 60 |
| `LEAQIZ_ABO` | `ja`: Live-Spiele nur mit Abo (Demo, Editor, Quizze im Konto bleiben frei) | nein |
| `LEAQIZ_ZAHLUNG` | `paypal`; leer = kein Abo, keine Kündigungs-Links. `simulation` nur lokal (Entwicklung) | leer |
| `LEAQIZ_BETREIBER_MAIL` | Hinweise an dich (Kündigung ohne passenden Vertrag, Erstattung fehlgeschlagen) | leer (nur Log) |
| `PAYPAL_UMGEBUNG`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_PLAN_ID` | PayPal-Zugang (siehe „Abo“) | `sandbox`, sonst Pflicht bei `paypal` |

## Abo (D-58)

Erst einschalten, wenn **AGB und Widerrufsbelehrung** von einer Fachperson stehen (Platzhalter unter
`server/seiten/agb.html` und `widerrufsbelehrung.html`) und das **Gewerbe** angemeldet ist.

1. developer.paypal.com mit dem PayPal-Geschäftskonto: unter „Apps & Credentials“ eine App anlegen
   (zuerst **Sandbox**). Client-ID und Secret notieren, nirgends einchecken.
2. Plan und Benachrichtigung anlegen (auf dem eigenen Rechner oder dem Server):
   `cd server && PAYPAL_UMGEBUNG=sandbox PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… node scripts/paypal-plan.js --webhook https://DOMAIN/api/abo/paypal`
   Ausgabe: `PAYPAL_PLAN_ID` und `PAYPAL_WEBHOOK_ID`.
3. In `/etc/leaqizz/einstellungen.env` eintragen: `LEAQIZ_ZAHLUNG='paypal'`, die PayPal-Werte,
   `LEAQIZ_BETREIBER_MAIL`, dann `leaqizz-einrichten`. Erst testen, dann `LEAQIZ_ABO='ja'`.
4. In der Sandbox einmal ganz durchspielen: abonnieren (Sandbox-Käuferkonto), Rückkehr, Zahlung im Konto,
   „Verträge hier kündigen“, „Vertrag widerrufen“ mit Erstattung. **Nicht geprüft:** wie PayPal den bezahlten
   ersten Abschnitt (ein Jahr) anzeigt, und der Erstattungsweg (`/v1/payments/sale/{id}/refund`).
5. Für echtes Geld: Schritte 1 bis 3 mit einer Live-App und `PAYPAL_UMGEBUNG='live'` wiederholen.

Lokal ohne PayPal: `LEAQIZ_ZAHLUNG=simulation LEAQIZ_ABO=ja` – die Zustimmungsseite ist dann `/abo/simulation/`.

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
