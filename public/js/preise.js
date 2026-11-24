'use strict';

// Preisseite: Mit eigenem Server und eingeschaltetem Abo führen „Monatsabo abschließen“ und
// „Jahrespass kaufen“ in die App (Anmeldung, dann Angebot mit dem gewählten Tarif).
// Sonst (GitHub Pages, Abo aus) bleibt die Seite eine Vorschau.
// Bildsprache (D-62): Das Wesen auf dem Jahrespass hüpft einmal, wenn die Karte ins Bild kommt.
// „Bewegung reduzieren“ hält es im CSS still; ohne Skript steht es einfach da.
(function () {
  const motiv = document.querySelector('.plan__motiv');
  if (!motiv || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries[0].isIntersecting) return;
      motiv.classList.add('is-in');
      io.disconnect();
    },
    { threshold: 0.6 },
  );
  io.observe(motiv);
})();

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
