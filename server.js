'use strict';

const { createApp } = require('./src/app');

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const app = createApp();

app.server.listen(port, host, () => {
  console.log(`Quizrunde läuft auf http://localhost:${port}  (Host-Ansicht: /host)`);
  if (!app.config.hostPassword) {
    console.log('Hinweis: HOST_PASSWORD ist nicht gesetzt – jeder mit dem Link kann Spiele starten.');
  }
});

function shutdown(signal) {
  console.log(`${signal} empfangen, fahre herunter …`);
  app.close();
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
