# leaqizz

Live-Quiz für Unterricht und Schulungen. Die Spielleitung zeigt Fragen am Beamer, die Teilnehmenden antworten am Handy. Sie brauchen keinen Account und keine App, nur PIN und Spielnamen.

> **Status: Prototyp.** Statische Webseite auf GitHub Pages, ohne eigenen Server. Die Geräte verbinden sich direkt miteinander (WebRTC). Vor dem Einsatz mit Klassen bitte die Grenzen unten lesen.
>
> **Name.** „leaqizz“ (bis 22.11.2026 „leaqiz“) ist noch nicht markenrechtlich geprüft. Repository, Web-Adresse und interne Kennungen (Speicher, Vermittlungs-Präfix) heißen vorerst weiter `leaqiz`, damit Links und gespeicherte Quizze erhalten bleiben. Geplante Adresse: leaqizz.com. Das Projekt hat keine Verbindung zu Kahoot! ASA und nutzt weder deren Namen noch deren Gestaltung.

## Für Lehrkräfte

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

- Spiel-Logik: `public/js/engine/` (läuft im Browser der Spielleitung und in den Tests)
- Spieler bekommen die richtige Antwort erst nach dem Schließen der Frage. Punkte berechnet nur die Spielleitung.

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

```
public/                 die veröffentlichte Seite
  index.html            Spieler (Handy)
  host/index.html       Spielleitung (Bibliothek, Editor, Beamer)
  js/engine/            Spiel-Logik, Eingabeprüfung, Host-Engine
  js/net.js             Direktverbindung (PeerJS)
  js/config.js          Vermittlungsserver (leer = öffentlicher PeerJS-Server)
dev/serve.js            lokaler Entwicklungsserver
test/                   Tests (node:test)
```

Die frühere Variante mit eigenem Node.js-Server liegt im Git-Verlauf (Commit `875fb9e`).

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

Die Lizenz des eigenen Codes ist noch nicht festgelegt. Ein öffentliches Repo ohne Lizenz heißt: einsehbar, aber nicht zur Weiterverwendung freigegeben.
