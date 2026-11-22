// Mailversand. Im Betrieb per SMTP (Hetzner-Postfach, Port 587 mit STARTTLS).
// Lokal ohne SMTP: Die Mail landet im Server-Log, damit man den Anmeldelink anklicken kann.
import nodemailer from 'nodemailer';

export function createMailer(mail, log = console) {
  if (!mail) {
    return {
      local: true,
      async send({ to, subject, text }) {
        log.warn(`Mail (nur lokal, nicht versendet) an ${to}: ${subject}\n${text}`);
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: mail.host,
    port: mail.port,
    secure: mail.port === 465,
    requireTLS: mail.port !== 465,
    auth: { user: mail.user, pass: mail.pass },
  });
  return {
    local: false,
    async send({ to, subject, text, html }) {
      await transport.sendMail({ from: mail.from, to, subject, text, html });
    },
  };
}

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Inhalt der Anmeldemail. Ansprache „du“ wie auf der Lehrkräfte-Seite.
export function magicLinkMail(url, minutes) {
  const text = [
    'Hallo,',
    '',
    'mit diesem Link meldest du dich bei leaqizz an:',
    url,
    '',
    `Der Link gilt ${minutes} Minuten und nur einmal. Öffne ihn auf dem Gerät, auf dem du leaqizz nutzen willst.`,
    'Hast du keinen Link angefordert? Dann ignoriere diese Mail. Ohne Klick passiert nichts.',
    '',
    'leaqizz',
  ].join('\n');
  const html = `<!doctype html><html lang="de"><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#121826">
<p>Hallo,</p>
<p>mit diesem Link meldest du dich bei leaqizz an:</p>
<p><a href="${escape(url)}" style="display:inline-block;padding:12px 20px;background:#121826;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">Bei leaqizz anmelden</a></p>
<p>Der Link gilt ${minutes} Minuten und nur einmal. Öffne ihn auf dem Gerät, auf dem du leaqizz nutzen willst.</p>
<p>Hast du keinen Link angefordert? Dann ignoriere diese Mail. Ohne Klick passiert nichts.</p>
<p>leaqizz</p>
</body></html>`;
  return { subject: 'Dein Anmeldelink für leaqizz', text, html };
}
