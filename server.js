'use strict';

const { spawn } = require('node:child_process');
const { createApp } = require('./src/app');
const { lanAddresses } = require('./src/network');

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const app = createApp();

app.server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} ist schon belegt. Läuft leaqiz bereits in einem anderen Fenster?`);
    console.error('Anderen Port wählen: PORT=3001 starten.');
  } else {
    console.error('Server konnte nicht starten:', err.message);
  }
  process.exit(1);
});

app.server.listen(port, host, () => {
  const hostUrl = `http://localhost:${port}/host`;
  const lan = lanAddresses();
  console.log('');
  console.log('leaqiz läuft.');
  console.log(`  Spielleitung (dieser Rechner): ${hostUrl}`);
  if (app.config.publicUrl) {
    console.log(`  Spieler:                       ${app.config.publicUrl}`);
  } else if (lan.length) {
    console.log(`  Spieler (selbes WLAN):         http://${lan[0].address}:${port}`);
    for (const extra of lan.slice(1)) console.log(`  weitere Adresse (${extra.name}):  http://${extra.address}:${port}`);
  } else {
    console.log('  Kein Netzwerk gefunden. Spieler können erst beitreten, wenn der Rechner im WLAN ist.');
  }
  if (!app.config.hostPassword) {
    console.log('Hinweis: Ohne HOST_PASSWORD kann jeder, der diese Seite erreicht, Spiele starten (im eigenen WLAN meist unkritisch).');
  }
  console.log('Beenden: dieses Fenster schließen oder Strg+C.');
  console.log('');
  if (process.env.OPEN_BROWSER === '1') openBrowser(hostUrl);
});

// Öffnet die Host-Ansicht im Standardbrowser (für den Start per Doppelklick).
function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => console.log(`Bitte im Browser öffnen: ${url}`));
    child.unref();
  } catch {
    console.log(`Bitte im Browser öffnen: ${url}`);
  }
}

function shutdown(signal) {
  console.log(`${signal} empfangen, fahre herunter …`);
  app.close();
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
