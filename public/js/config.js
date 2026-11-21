// Verbindungs-Einstellungen für die Direktverbindung (PeerJS).
//
// peer: leer = öffentlicher, kostenloser PeerJS-Vermittlungsserver (0.peerjs.com).
//       Für einen eigenen Vermittlungsserver hier host/port/path eintragen.
//
// Relais (TURN): nötig, wenn Spieler im Mobilfunk oder Schulnetz keine Direktverbindung bekommen.
//   turnCredentialsUrl: Adresse, die eine Liste von iceServers liefert,
//                       z. B. Metered Open Relay: 'https://<name>.metered.live/api/v1/turn/credentials?apiKey=<schlüssel>'
//   iceServers:         feste Server mit Zugangsdaten, z. B. [{ urls: 'turn:…', username: '…', credential: '…' }]
//   Hinweis: Beides ist im Browser jeder Person sichtbar, die leaqiz öffnet.
//   Leer = Relais des PeerJS-Projekts (laut Verbindungstest oft nicht erreichbar).
window.LEAQIZ_CONFIG = {
  peer: {},
  turnCredentialsUrl: '',
  iceServers: [],
};
