# Weiterleitung (D-61)

Nach dem Start auf der eigenen Domain zeigt GitHub Pages nur noch diese Seite: `index.html` und `404.html`
(gleicher Inhalt, damit auch jeder andere Pfad weiterleitet). Pfad und Abfrage werden mitgenommen,
`/leaqiz/host/` führt zu `https://leaqizz.com/host/`.

Eingeschaltet wird sie mit der Repo-Variable `PAGES_ZIEL` (z. B. `https://leaqizz.com`, ohne Schrägstrich am
Ende). Der Workflow `pages.yml` liefert dann statt `public/` diese beiden Dateien aus und setzt das Ziel ein.
Ohne die Variable bleibt alles wie bisher. Beide Seiten tragen `noindex, nofollow`.
