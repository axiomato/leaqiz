'use strict';

// Preisseite: Mit eigenem Server und eingeschaltetem Abo führen „Monatsabo abschließen“ und
// „Jahrespass kaufen“ in die App (Anmeldung, dann Angebot mit dem gewählten Tarif).
// Sonst (GitHub Pages, Abo aus) bleibt die Seite eine Vorschau.
(function () {
  const server = window.LEAQIZ_CONFIG && window.LEAQIZ_CONFIG.server;
  if (!server || !server.abo) return;
  for (const cta of document.querySelectorAll('[data-tarif]')) {
    cta.href = `../host/?abo=start&tarif=${cta.dataset.tarif}`;
    cta.removeAttribute('aria-disabled');
    cta.removeAttribute('role');
    const note = document.getElementById(cta.getAttribute('aria-describedby'));
    if (note) note.textContent = 'Bezahlt wird über PayPal.';
  }
  document.getElementById('preise-vorschau').hidden = true;
})();
