# Quizrunde

Live-Quiz für Unterricht und Schulungen. Die Spielleitung zeigt Fragen am Beamer, die Teilnehmenden antworten am Handy. Sie brauchen keinen Account, nur PIN und Spielname.

> **Arbeitstitel.** „Quizrunde“ ist noch nicht markenrechtlich geprüft. Das Projekt hat keine Verbindung zu Kahoot! ASA und nutzt weder deren Namen noch deren Gestaltung.

## Funktionsumfang (Version 0.1)

| Bereich | Umfang |
|---|---|
| Quiz-Editor | Multiple Choice (2–4 Antworten, auch mehrere richtig) und Wahr/Falsch, Zeitlimit 5–240 s, Reihenfolge ändern |
| Ablage | Quizze bleiben im Browser der Spielleitung, Export und Import als JSON-Datei |
| Beitritt | 6-stellige PIN oder QR-Code, Spielname bis 20 Zeichen, kein Login |
| Spielablauf | Lobby → Countdown → Frage → Auflösung mit Verteilung → Zwischenstand (Top 5) → … → Podium |
| Punkte | Richtig: 1.000 sofort bis 500 in letzter Sekunde (linear). Serien-Bonus +100 je weiterer richtiger Antwort in Folge, max. +500 |
| Steuerung | Host kann Spieler entfernen, Frage vorzeitig beenden, Spiel beenden. „Weiter“ auch per Pfeil rechts / Bild runter (Präsentations-Fernbedienung) |
| Ausfälle | Spieler und Host können neu laden oder die Verbindung verlieren und kommen automatisch zurück |
| Auswertung | CSV-Export für Excel (Platz, Punkte, jede Antwort mit Zeit und Punkten) |

## Schnellstart (lokal)

Voraussetzung: Node.js 20 oder neuer.

```bash
npm install
npm start
```

- Spielleitung: `http://localhost:3000/host`
- Spieler im selben WLAN: `http://<IP-des-Rechners>:3000`. Die Adresse steht auch in der Lobby, dazu ein QR-Code.

Tests: `npm test` (Spiel-Logik und komplette Spiele über echte WebSocket-Verbindungen).

## Konfiguration (Umgebungsvariablen)

| Variable | Standard | Zweck |
|---|---|---|
| `PORT` | `3000` | HTTP-Port |
| `HOST_PASSWORD` | leer | Ist es gesetzt, dürfen nur Personen mit Passwort Spiele starten. **Für jeden öffentlich erreichbaren Server setzen.** |
| `TRUST_PROXY` | aus | `1` setzen, wenn ein Reverse Proxy davor läuft (für korrekte IP-Begrenzung und Origin-Prüfung) |
| `ALLOWED_ORIGINS` | leer | Weitere erlaubte Origins, kommagetrennt (nur nötig bei abweichender Domain) |
| `MAX_PLAYERS` | `200` | Spieler pro Spiel |
| `MAX_GAMES` | `100` | Gleichzeitige Spiele pro Server |
| `COUNTDOWN_MS` | `4000` | Lesezeit vor jeder Frage |

## Betrieb

**Live-Betrieb über GitHub und Render:** siehe [PUBLISHING.md](PUBLISHING.md).

**Wichtig:** Spiele liegen nur im Arbeitsspeicher. Es darf **genau eine** Instanz laufen. Ein Neustart beendet laufende Spiele, die Quizze im Browser der Spielleitung bleiben erhalten.

### Mit Docker

```bash
docker build -t quizrunde .
docker run -d --name quizrunde -p 3000:3000 \
  -e HOST_PASSWORD='bitte-ändern' -e TRUST_PROXY=1 \
  --restart unless-stopped quizrunde
```

### HTTPS und Reverse Proxy

Für den Einsatz im Internet HTTPS vorschalten. Der Proxy muss WebSockets durchreichen. Beispiel mit Caddy (holt Zertifikate automatisch):

```
quiz.example.de {
    reverse_proxy 127.0.0.1:3000
}
```

Bei nginx die Header `Upgrade` und `Connection` für den Pfad `/socket.io/` weiterleiten.

## Datenschutz (DSGVO)

*Technische Einordnung, keine Rechtsberatung.*

| Daten | Wo | Wie lange |
|---|---|---|
| Spielname, Antworten, Punkte | Arbeitsspeicher des Servers | bis das Spiel geschlossen wird (spätestens 30 min nach Spielende, 15 min ohne Host oder 2 h ohne Aktivität) |
| IP-Adresse | Arbeitsspeicher, nur bei falscher PIN (Schutz vor PIN-Raten) | 1–2 Minuten |
| Wiederverbindungs-Token | `sessionStorage` im Browser | bis der Tab geschlossen wird |
| Quizze | `localStorage` im Browser der Spielleitung | bis zum Löschen |

- Keine Datenbank, keine Cookies, kein Tracking, keine externen Schriften oder CDNs. Alle Dateien kommen vom eigenen Server.
- Die Anwendung schreibt keine Spielnamen oder IP-Adressen ins Log. **Prüfen:** Logs von Hoster und Reverse Proxy.
- **Offen für den Betrieb:** Datenschutzerklärung, Impressum bei öffentlichem Angebot, Vertrag zur Auftragsverarbeitung mit dem Hoster, Hosting in der EU.
- Empfehlung für Lehrkräfte: Kinder und Jugendliche sollen Spitznamen statt Klarnamen nutzen. Die Spielleitung kann unpassende Namen entfernen.

## Barrierefreiheit

- Antworten unterscheiden sich durch Buchstabe A–D, Farbe und Text, nie nur durch Farbe.
- Alle Farbkombinationen erreichen mindestens 4,5:1 Kontrast (WCAG AA).
- Komplett per Tastatur bedienbar, sichtbarer Fokus. Spieler können mit 1–4 oder A–D antworten.
- Screenreader-Ansagen bei Fragewechsel, Ergebnis und Endstand. Keine dekorativen Animationen, die einzige Bewegung ist der Zeitbalken.
- Automatischer Test mit axe-core (WCAG 2.2 AA): 0 Befunde.
- **Grenzen:** Ein automatischer Test findet nur einen Teil der Probleme. Ein manueller Test mit Screenreader (VoiceOver, TalkBack, NVDA) steht aus. Zeitdruck gehört zum Spielprinzip. Die Spielleitung kann bis zu 240 s pro Frage einstellen, eine Verlängerung für einzelne Personen gibt es nicht.

## Sicherheit

- Der Server prüft alle Eingaben und begrenzt Länge und Menge (Quiz max. 100 Fragen, Nachrichten max. 256 KB).
- Spieler erhalten die richtige Antwort erst nach dem Schließen der Frage. Über die Entwicklertools lässt sich also nicht schummeln.
- Antwortzeit und Punkte berechnet nur der Server.
- Nutzertexte gelangen nur als Text ins Dokument (kein `innerHTML`). Dazu kommt eine strenge Content-Security-Policy.
- Begrenzung bei falschen PINs (20 pro Minute und IP) und gegen Nachrichtenfluten pro Verbindung.
- WebSocket-Verbindungen nur von der eigenen Domain. Tokens zufällig (128 Bit), Vergleich in konstanter Zeit.
- CSV-Export entschärft Formeln (Schutz vor CSV-Injection).

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

`correct` enthält die Positionen der richtigen Antworten (ab 0). Erlaubte Zeitlimits: 5, 10, 20, 30, 45, 60, 90, 120, 240 Sekunden.

## Aufbau

```
server.js          Start, Signale
src/app.js         HTTP (statische Dateien, Sicherheits-Header) und WebSocket-Ereignisse, Timer, Aufräumen
src/game.js        Spiel-Logik als reine Zustandsmaschine (ohne Netzwerk, testbar)
src/validate.js    Prüfung und Bereinigung aller Eingaben
public/host.html   Spielleitung: Bibliothek, Editor, Beamer-Ansicht
public/index.html  Spieler-Ansicht (Handy)
public/js/         Browser-Code; vendor/qrcode.js für den QR-Code
test/              Unit- und Ende-zu-Ende-Tests (node:test)
```

## Nächste sinnvolle Schritte

1. Pilot mit einer echten Gruppe im Zielnetz (Schul-WLAN, Firmennetz)
2. Weitere Fragetypen: Freitext, Schieberegler, Reihenfolge, Umfrage ohne Punkte
3. Bilder zu Fragen
4. Teammodus und selbstgesteuerte Aufgaben (ohne Live-Host)
5. Gemeinsame Quiz-Ablage für ein Team (braucht Accounts und Datenbank)
6. Musik und Soundeffekte (abschaltbar)

## Lizenzen von Drittkomponenten

- Socket.IO, MIT-Lizenz
- qrcode-generator von Kazuhiko Arase, MIT-Lizenz (`public/js/vendor/qrcode.js`)
- Schrift Archivo, SIL Open Font License 1.1 (`public/fonts/OFL-Archivo.txt`)

Die Lizenz des eigenen Codes ist noch nicht festgelegt (`UNLICENSED`).
