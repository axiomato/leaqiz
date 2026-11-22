// Verbindungs-Einstellungen für die Direktverbindung (PeerJS).
//
// peer: leer = öffentlicher, kostenloser PeerJS-Vermittlungsserver (0.peerjs.com).
//       Für einen eigenen Vermittlungsserver hier host/port/path eintragen.
//
// Relais (TURN): nötig, wenn Spieler im Mobilfunk oder Schulnetz keine Direktverbindung bekommen.
//   turnCredentialsUrl: Adresse, die eine Liste von iceServers liefert,
//                       z. B. Metered Open Relay: 'https://<name>.metered.live/api/v1/turn/credentials?apiKey=<schlüssel>'
//   iceServers:         feste Server mit Zugangsdaten, z. B. [{ urls: 'turn:…', username: '…', credential: '…' }]
//   Hinweis: Beides ist im Browser jeder Person sichtbar, die leaqizz öffnet.
//   Leer = Relais des PeerJS-Projekts (laut Verbindungstest oft nicht erreichbar).
window.LEAQIZ_CONFIG = {
  peer: {},
  turnCredentialsUrl: '',
  iceServers: [],
  // Unterstützen (Landingpage /lehrkraefte/): Links zu einer gehosteten Bezahlseite, z. B. Stripe Payment Links.
  //   provider: Name des Anbieters, erscheint auf dem Knopf und im Hinweis
//   PayPal: im Geschäftskonto unter paypal.com/de/donate/buttons einen Spenden-Button anlegen,
//           den Link (https://www.paypal.com/donate/?hosted_button_id=…) hier eintragen.
//           Nur custom gesetzt = ein Knopf, Betrag wählen die Unterstützer bei PayPal.
//           Zusätzlich Festbetrags-Buttons unter amounts = die Beträge erscheinen als Podest.
  //   amounts:  Betrag in Euro -> Link mit festem Betrag
  //   custom:   Link, auf dem der Betrag frei gewählt wird (wird genutzt, wenn für einen Betrag kein Link da ist)
  //   Alles leer = Knopf inaktiv mit Hinweis „wird eingerichtet“. Nur https-Links werden verwendet.
  donate: { provider: 'PayPal', amounts: { 5: '', 10: '', 25: '' }, custom: '' },
};
