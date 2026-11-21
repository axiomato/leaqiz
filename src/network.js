'use strict';

// Ermittelt die Adresse, unter der Spieler im selben Netz den Laptop der
// Spielleitung erreichen. Wichtig für den Betrieb ohne Hosting: Wer /host über
// "localhost" öffnet, darf den Spielern nicht "localhost" anzeigen.

const os = require('node:os');

const VIRTUAL = /vbox|virtual|vmnet|vmware|docker|veth|br-|vethernet|wsl|hyper-v|tailscale|zerotier|utun|tun|tap|loopback/i;
const PREFERRED = /wi-?fi|wlan|wlp|wireless|^en\d|^eth|ethernet/i;

function isPrivateIPv4(ip) {
  return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

// Sortiert die Kandidaten: echte WLAN-/LAN-Adapter mit privater Adresse zuerst,
// virtuelle Adapter (VirtualBox, Docker, VPN) zuletzt.
function rankAddresses(interfaces) {
  const candidates = [];
  for (const [name, list] of Object.entries(interfaces || {})) {
    for (const a of list || []) {
      const isV4 = a.family === 'IPv4' || a.family === 4;
      if (!isV4 || a.internal || a.address.startsWith('169.254.')) continue;
      let score = 0;
      if (VIRTUAL.test(name)) score += 100;
      if (!isPrivateIPv4(a.address)) score += 20;
      if (!PREFERRED.test(name)) score += 5;
      candidates.push({ name, address: a.address, score });
    }
  }
  return candidates.sort((x, y) => x.score - y.score).map(({ name, address }) => ({ name, address }));
}

function lanAddresses() {
  return rankAddresses(os.networkInterfaces());
}

function isLocalHostHeader(hostHeader) {
  const hostname = String(hostHeader || '')
    .replace(/:\d+$/, '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

// publicUrl (Konfiguration) gewinnt. Sonst nur bei Aufruf über localhost die LAN-Adresse.
// null bedeutet: Der Browser der Spielleitung nimmt seine eigene Adresse.
function joinUrlFor({ publicUrl, hostHeader, port, addresses }) {
  if (publicUrl) return publicUrl.replace(/\/+$/, '');
  if (!isLocalHostHeader(hostHeader)) return null;
  const first = (addresses || lanAddresses())[0];
  return first ? `http://${first.address}:${port}` : '';
}

module.exports = { rankAddresses, lanAddresses, isLocalHostHeader, joinUrlFor, isPrivateIPv4 };
