'use strict';

// Preisseite: Mit eigenem Server und eingeschaltetem Abo führt „Abo abschließen“ in die App
// (Anmeldung, dann Angebot). Sonst (GitHub Pages, Abo aus) bleibt die Seite eine Vorschau.
(function () {
  const server = window.LEAQIZ_CONFIG && window.LEAQIZ_CONFIG.server;
  if (!server || !server.abo) return;
  const cta = document.getElementById('abo-cta');
  cta.href = '../host/?abo=start';
  cta.removeAttribute('aria-disabled');
  cta.removeAttribute('role');
  document.getElementById('abo-cta-note').textContent = 'Bezahlt wird über PayPal. Kündigen jederzeit zum Ende der Laufzeit.';
  document.getElementById('preise-vorschau').hidden = true;
})();
