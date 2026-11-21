# Veröffentlichung: GitHub → Render

Stand: Version 0.1.0

## 1. Architektur

```
Push auf main ──► GitHub Actions (npm test) ──► grün ──► Render baut und startet neu
                                                          │
Spielleitung (/host) ◄──── HTTPS + WebSockets ────────────┤  leaqiz.onrender.com
Spieler (Handy)      ◄────────────────────────────────────┘  Region Frankfurt
```

- **Repo:** `axiomato/leaqiz` (privat)
- **Hosting:** Render Web Service, Tarif „Free“, Region Frankfurt, Einstellungen in `render.yaml`
- **Warum nicht GitHub Pages:** GitHub Pages liefert nur statische Dateien. Der Spiel-Server (Node.js mit WebSockets) läuft dort nicht.
- **Eine Instanz:** Spiele liegen im Arbeitsspeicher. Nicht auf mehrere Instanzen skalieren.

## 2. Einmalige Einrichtung bei Render (ca. 10 Minuten)

1. Auf render.com mit dem GitHub-Konto `axiomato` anmelden.
2. **New → Blueprint** wählen und Render Zugriff auf das Repo `axiomato/leaqiz` geben (nur dieses Repo freigeben).
3. Render liest `render.yaml` und fragt nach `HOST_PASSWORD`. Ein starkes Passwort eintragen und im Passwort-Manager ablegen. Wer es kennt, kann Spiele starten.
4. **Apply** klicken. Der erste Build dauert einige Minuten.
5. Prüfen:
   - `https://<dienstname>.onrender.com/healthz` antwortet mit `{"ok":true}`
   - `/host` öffnen, Beispiel-Quiz starten, Passwort eingeben
   - Mit einem Handy (mobile Daten, nicht WLAN) per QR-Code beitreten und eine Frage spielen
6. Den Render-Vertrag zur Auftragsverarbeitung (DPA, render.com/dpa) zu den Unterlagen nehmen.

## 3. Updates

```bash
# Änderungen machen, dann:
npm test
echo "0.2.0" > VERSION            # SemVer: Patch = Korrektur, Minor = neue Funktion
git add -A && git commit -m "v0.2.0: <Beschreibung>"
git tag v0.2.0
git push && git push --tags
```

Render deployt automatisch, sobald die Tests in GitHub Actions grün sind (`autoDeployTrigger: checksPass`). Rote Tests blockieren das Deploy.

**Achtung:** Jedes Deploy startet den Server neu und beendet laufende Spiele. Nicht während einer Unterrichtsstunde pushen.

## 4. Grenzen des Gratis-Tarifs

| Punkt | Auswirkung | Umgang |
|---|---|---|
| Schläft nach 15 min ohne Anfragen | Das erste Öffnen danach dauert länger (Kaltstart) | Host-Seite einige Minuten vor Beginn öffnen |
| Render darf Gratis-Dienste jederzeit neu starten | Ein laufendes Spiel kann abbrechen | Für Pilot ok. Für den Regelbetrieb bezahlten Tarif ohne Schlafmodus wählen |
| 0,1 CPU, 512 MB RAM | Reicht nach lokalem Test für 200 Spieler in einem Spiel. Unter echter Netzlast nicht geprüft | Beim Pilot beobachten (Render-Metriken) |
| Eigene Domain | laut Render-Tutorial nicht im Gratis-Tarif | bei Bedarf Tarif wechseln |

## 5. Compliance-Check

| Prüfung | Ergebnis |
|---|---|
| Secrets im Repo | keine. `HOST_PASSWORD` liegt nur bei Render |
| Fremde Marken oder Logos | keine. Eigener Name und eigene Gestaltung, kein Kahoot!-Material |
| Fremde Inhalte | Beispiel-Quiz selbst geschrieben. Schrift (OFL) und QR-Bibliothek (MIT) mit Lizenzhinweis |
| Personenbezogene Daten | Spielname, Antworten und kurzzeitig IP-Adressen, nur im Arbeitsspeicher (Details im README) |
| Auftragsverarbeitung | Render bietet einen DPA an. Region Frankfurt gewählt. Render ist ein US-Unternehmen |
| Zugriffsschutz | Spiele starten nur mit `HOST_PASSWORD`. Mitspielen ist bewusst offen (PIN) |

**Offen vor öffentlichem Einsatz:**
- Datenschutzerklärung und Impressum (bei öffentlichem Angebot) verlinken
- Markenprüfung „leaqiz“
- Lizenz des eigenen Codes festlegen (aktuell `UNLICENSED`)
- Bei Einsatz an Schulen: Abstimmung mit der bzw. dem Datenschutzbeauftragten

## 6. Lokal entwickeln

```bash
npm install
npm start          # http://localhost:3000/host
npm test
```
