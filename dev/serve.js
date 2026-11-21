'use strict';

// Nur für die Entwicklung: liefert public/ unter http://localhost:8080/leaqiz/ aus
// (wie GitHub Pages mit Unterpfad) und startet einen lokalen PeerJS-Vermittlungsserver.
// So läuft alles offline, ohne den öffentlichen PeerJS-Server.
//   npm run dev

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { PeerServer } = require('peer');

const PORT = Number(process.env.PORT) || 8080;
const PEER_PORT = Number(process.env.PEER_PORT) || 9000;
const BASE = '/leaqiz/';
const ROOT = path.resolve(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const DEV_CONFIG = `window.LEAQIZ_CONFIG = { peer: { host: 'localhost', port: ${PEER_PORT}, path: '/', secure: false, config: { iceServers: [] } } };\n`;

PeerServer({ port: PEER_PORT, path: '/', host: '127.0.0.1' });

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') {
      res.writeHead(302, { Location: BASE });
      return res.end();
    }
    if (!url.pathname.startsWith(BASE)) {
      res.writeHead(404);
      return res.end('Nicht gefunden');
    }
    let rel = decodeURIComponent(url.pathname.slice(BASE.length));
    if (rel === 'js/config.js') {
      res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
      return res.end(DEV_CONFIG);
    }
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep)) {
      res.writeHead(404);
      return res.end();
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('Nicht gefunden');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  })
  .listen(PORT, () => {
    console.log(`leaqiz (Entwicklung): http://localhost:${PORT}${BASE}host/   Vermittlung: localhost:${PEER_PORT}`);
  });
