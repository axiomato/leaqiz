# leaqizz

Live-Quiz für Unterricht und Schulungen. Die Spielleitung zeigt Fragen am Beamer, die Teilnehmenden antworten am Handy. Sie brauchen keinen Account und keine App, nur PIN und Spielnamen.

> **Status: Prototyp.** Statische Webseite auf GitHub Pages, ohne eigenen Server. Die Geräte verbinden sich direkt miteinander (WebRTC). Vor dem Einsatz mit Klassen bitte die Grenzen unten lesen.
>
> **Name.** „leaqizz“ (bis 22.11.2026 „leaqiz“) ist noch nicht markenrechtlich geprüft. Repository, Web-Adresse und interne Kennungen (Speicher, Vermittlungs-Präfix) heißen vorerst weiter `leaqiz`, damit Links und gespeicherte Quizze erhalten bleiben. Geplante Adresse: leaqizz.com. Das Projekt hat keine Verbindung zu Kahoot! ASA und nutzt weder deren Namen noch deren Gestaltung.

## Für Lehrkräfte

Infoseite mit Demo und „Unterstützen“: `https://axiomato.github.io/leaqiz/lehrkraefte/` (Prototyp; Suchmaschinen sind auf allen Seiten dauerhaft gesperrt, ein Test prüft das; Zahlungslinks in `public/js/config.js` unter `donate`).

1. Spielleitung öffnen: `https://axiomato.github.io/leaqiz/host/` (als Lesezeichen speichern)
2. Quiz wählen → **Spiel starten**
3. Die Klasse scannt den QR-Code an der Leinwand oder öffnet `axiomato.github.io/leaqiz` und tippt die PIN ein.

**Wichtig:** Den Tab der Spielleitung während des Spiels offen und möglichst im Vordergrund lassen. Dieser Tab *ist* das Spiel. Neu laden ist erlaubt, schließen beendet das Spiel.

## Funktionsumfang

| Bereich | Umfang |
|---|---|
| Quiz-Editor | Multiple Choice (2–4 Antworten, auch mehrere richtig) und Wahr/Falsch, Zeitlimit 5–240 s |
| Ablage | Quizze bleiben im Browser der Spielleitung, Export und Import als JSON-Datei |
| Beitritt | 6-stellige PIN oder QR-Code, Spielname bis 20 Zeichen |
| Ablauf | Lobby → Countdown → Frage → Auflösung → Zwischenstand (Top 5) → Podium |
| Punkte | Richtig: 1.000 sofort bis 500 in letzter Sekunde. Serien-Bonus +100 je weiterer richtiger Antwort, max. +500 |
| Steuerung | Spieler entfernen, Frage vorzeitig beenden, „Weiter“ auch per Pfeil rechts / Bild runter |
| Ausfälle | Spieler und Spielleitung können neu laden, das Spiel läuft weiter |
| Auswertung | CSV-Export für Excel |

## So funktioniert es

```
GitHub Pages ──► liefert nur die Dateien (HTML, CSS, JS)

Browser der Spielleitung = Spiel-Server
   │  meldet sich als „leaqiz-<PIN>“ beim Vermittlungsserver an (PeerJS)
   ▼
Handys der Spieler ──► finden die Spielleitung über die PIN
                   ──► danach Daten direkt per WebRTC, sonst über TURN-Relais
```

- Spiel-Logik: `public/js/engine/` (läuft im Browser der Spielleitung, auf dem Spielserver und in den Tests)
- Spieler bekommen die richtige Antwort erst nach dem Schließen der Frage. Punkte berechnet nur die Spielleitung.

### Mit eigenem Server (im Aufbau, Phase 1)

```
Caddy (HTTPS) ──► leaqizz-Server (server/) ──► PostgreSQL
                    │ liefert public/ aus, ergänzt js/config.js um den Spielserver
                    │ führt Live-Spiele: je Spiel eine HostEngine, Zustand in der Datenbank
Leinwand und Handys ──► WebSocket /ws über Port 443 (kein Relais, kein PeerJS)
```

- Der Browser erkennt den Server an `window.LEAQIZ_CONFIG.server` und nutzt dann WebSocket statt Direktverbindung. Ohne diesen Eintrag (GitHub Pages) bleibt alles wie oben. Die Demo läuft immer im Browser.
- Spiele überstehen Neuladen der Leinwand und Neustart des Servers.
- Live-Spiele starten nur angemeldete Lehrkräfte: Anmeldelink per Mail oder Passkey (Better Auth, `public/js/account.js`). Schüler:innen brauchen kein Konto.
- Tarife (D-58, D-60, eingebaut, noch aus): **Monatsabo** 4,99 € im Monat (kündbar zum Ende des bezahlten Monats) und **Jahrespass** 47,88 € für zwölf Monate (endet von selbst, Erinnerung 14 Tage vorher, Verlängern schließt an). Mit `LEAQIZ_ABO=ja` starten Live-Spiele nur mit einem der beiden; Demo, Editor und Quizze im Konto bleiben kostenlos. Zahlung über PayPal, Kündigen und Widerrufen ohne Anmeldung (`/vertraege-kuendigen/`, `/vertrag-widerrufen/`, Links im Fuß jeder Seite). Lokal ohne PayPal: `LEAQIZ_ZAHLUNG=simulation`.
- Nach dem Start leitet GitHub Pages nur noch auf die eigene Domain weiter (D-61): Repo-Variable `PAGES_ZIEL`, Schritte in `deploy/README.md`.
- Betrieb: `deploy/README.md`. Zielarchitektur und Entscheidungen: Projekt „Kahoot! Nachbau“, `claude/leaqiz-architektur.md`.

## Grenzen des Prototyps

| Thema | Auswirkung |
|---|---|
| Schul- und Firmen-WLANs | Direktverbindungen und der TURN-Port 3478 sind dort oft gesperrt. Dann können Spieler nicht beitreten. **Vor dem ersten Einsatz im echten Netz testen.** Notlösung: mobile Daten |
| Kostenlose PeerJS-Server | Vermittlung (0.peerjs.com) und TURN-Relais sind ein Gratis-Angebot des PeerJS-Projekts ohne Garantie für Verfügbarkeit |
| Gruppengröße | Jede Verbindung läuft über den Browser der Spielleitung. Für Klassengröße gedacht, große Gruppen sind nicht getestet |
| Tab der Spielleitung | Im Hintergrund drosseln Browser die Timer, Fragen können dann etwas später schließen. Schließen des Tabs beendet das Spiel |
| Kein Host-Passwort | Jede Person mit dem Link kann Spiele starten. Das betrifft nur eigene Spiele, keine fremden Daten |

## Datenschutz (DSGVO)

*Technische Einordnung, keine Rechtsberatung.* leaqizz selbst speichert nichts auf einem Server. Spielname, Antworten und Punkte liegen nur im Browser der Spielleitung (Tab-Speicher) und verschwinden mit dem Spielende. Aber drei Fremddienste sehen IP-Adressen:

| Dienst | Was er sieht | Vertrag zur Auftragsverarbeitung |
|---|---|---|
| GitHub Pages (USA) | IP-Adressen beim Laden der Seite (laut GitHub zu Sicherheitszwecken) | über GitHub-Bedingungen |
| PeerJS-Vermittlung und TURN (Betreiber: PeerJS-Projekt) | IP-Adressen, zufällige Kennungen. TURN leitet verschlüsselte Daten weiter | keiner |
| Google STUN | IP-Adressen | keiner |

Die Spieldaten selbst laufen verschlüsselt (WebRTC ist immer verschlüsselt). **Für den Einsatz mit Schülerinnen und Schülern** reicht das voraussichtlich nicht: vorher mit der bzw. dem Datenschutzbeauftragten klären. Ausweg für später: eigener Vermittlungs- und TURN-Server in der EU (Einstellung in `public/js/config.js`).

## Barrierefreiheit

- Antworten unterscheiden sich durch Buchstabe A–D, Farbe und Text, nie nur durch Farbe. Kontrast überall mindestens 4,5:1.
- Komplett per Tastatur bedienbar. Spieler können mit 1–4 oder A–D antworten. Screenreader-Ansagen bei Fragewechsel und Ergebnis.
- Automatischer Test mit axe-core (WCAG 2.2 AA): 0 Befunde. Ein manueller Screenreader-Test steht aus.

## Einrichtung GitHub Pages (einmalig)

1. Repo auf **öffentlich** stellen: Settings → General → Danger Zone → *Change visibility*. GitHub Pages ist im Gratis-Plan nur für öffentliche Repos verfügbar.
2. Settings → Pages → *Build and deployment* → Source: **GitHub Actions**.
3. Unter Actions den letzten Lauf „Tests und GitHub Pages“ neu starten (*Re-run all jobs*).

Danach veröffentlicht jeder Push auf `main` automatisch, aber nur, wenn die Tests grün sind.

## Entwicklung

```bash
npm install
npm run dev     # http://localhost:8080/leaqiz/host/  mit lokalem Vermittlungsserver, offline
npm test        # Spiel-Logik und Host-Engine (Node)
```

Spielserver (braucht PostgreSQL):

```bash
cd server && npm install
cat > .env <<'ENV'
DATABASE_URL=postgres://leaqiz:…@localhost:5432/leaqiz
LEAQIZ_ORIGIN=http://localhost:3000
BETTER_AUTH_SECRET=…        # openssl rand -base64 32
ENV
npm run dev     # http://localhost:3000/host/  Anmeldelinks stehen lokal im Server-Log
npm test        # mit TEST_DATABASE_URL zusätzlich Anmeldung und Datenbank (leert diese Datenbank)
npm run lasttest -- --spiele 20 --spieler 30
npm run db:generate   # nach Änderungen an src/db/schema.js
```

```
public/                 die veröffentlichte Seite
  index.html            Spieler (Handy)
  host/index.html       Spielleitung (Bibliothek, Editor, Beamer)
  js/engine/            Spiel-Logik, Eingabeprüfung, Host-Engine
  js/net.js             Direktverbindung (PeerJS) und Verbindung zum Spielserver (WebSocket)
  js/avatar.js          Avatare: schräge Wesen aus sechs Zahlen, gezeichnet als SVG
  js/config.js          Vermittlungsserver (leer = öffentlicher PeerJS-Server)
  img/og-leaqizz.png    Vorschaubild für geteilte Links (1200 × 630)
  preise/               Preisseite: Kostenlos, Monatsabo, Jahrespass im Vergleich (ohne Server und ohne Abo eine Vorschau)
dev/serve.js            lokaler Entwicklungsserver
dev/og/                 Quelle des Vorschaubilds; neu erzeugen mit python3 dev/og/render.py
dev/avatar/             Teile-Bogen der Avatare; neu erzeugen mit python3 dev/avatar/render.py
test/                   Tests (node:test)
server/                 Spielserver: Fastify, WebSocket (ws), PostgreSQL (Drizzle)
  src/games/            Spiele verwalten, sichern, wiederherstellen; WebSocket-Zugang
  src/results.js        Ergebnisse vergangener Live-Spiele (aus dem gesicherten Endstand)
  src/billing/          Tarife: Angebot, PayPal (Abo und Bestellung), Simulation, Kündigen, Widerrufen, Erinnerung, Mails
  seiten/               Seiten nur für den Serverbetrieb (Datenschutz, AGB, Widerrufsbelehrung, Kündigen, Widerrufen)
  scripts/paypal-plan.js Plan fürs Monatsabo und Benachrichtigung bei PayPal anlegen
  drizzle/              Datenbank-Migrationen (erzeugt, eingecheckt)
  scripts/lasttest.js   viele Spiele mit simulierten Handys gleichzeitig
deploy/                 Docker Compose mit Caddy und PostgreSQL, Betriebsanleitung
  weiterleitung/        GitHub Pages nach dem Start: Weiterleitung auf die eigene Domain
```

Das Vorschaubild ist in Spielerseite, Spielleitung und Landingpage mit absoluter Adresse
unter `https://axiomato.github.io/leaqiz/` eingetragen. Beim Umzug auf eine eigene Domain
die `og:url`- und `og:image`-Adressen mitziehen; `test/og.test.js` prüft sie.

Die frühere Variante mit eigenem Node.js-Server (Socket.IO) liegt im Git-Verlauf (Commit `875fb9e`); der neue Server unter `server/` ersetzt sie.

## Quiz-Dateiformat

```json
{
  "title": "Beispiel",
  "questions": [
    { "type": "quiz", "text": "2 + 2?", "options": ["3", "4", "5"], "correct": [1], "timeLimit": 20 },
    { "type": "truefalse", "text": "Wasser ist nass.", "options": ["Wahr", "Falsch"], "correct": [0], "timeLimit": 10 }
  ]
}
```

## Lizenzen von Drittkomponenten

- PeerJS, MIT-Lizenz (`public/js/vendor/peerjs.min.js`, `LICENSE-peerjs.txt`)
- qrcode-generator von Kazuhiko Arase, MIT-Lizenz (`public/js/vendor/qrcode.js`)
- Schrift Archivo, SIL Open Font License 1.1 (`public/fonts/OFL-Archivo.txt`)
- SimpleWebAuthn (Browser), MIT-Lizenz (`public/js/vendor/simplewebauthn.min.js`, `LICENSE-simplewebauthn.txt`)
- Spielserver: Fastify, @fastify/static, ws, pg, Better Auth, nodemailer (MIT bzw. MIT-0), Drizzle ORM (Apache-2.0), Drizzle Kit (MIT, nur Entwicklung)

## Lizenz

Alle Rechte vorbehalten (`LICENSE`). Der Code ist hier öffentlich einsehbar, aber nicht frei nutzbar.
