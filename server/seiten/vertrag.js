'use strict';

// Kündigen und Widerrufen ohne Anmeldung (Serverbetrieb). Ein Formular je Seite: data-art="kuendigen" | "widerrufen".
// Nach dem Absenden zeigt die Seite die Erklärung mit Datum und Uhrzeit des Eingangs; sie lässt sich speichern und drucken.
(function () {
  const form = document.getElementById('vertrag-form');
  if (!form) return;
  const art = form.dataset.art;
  const error = document.getElementById('v-fehler');
  const submit = form.querySelector('button[type="submit"]');
  const submitLabel = submit.textContent;
  const beleg = document.getElementById('beleg');
  const fields = { name: document.getElementById('v-name'), email: document.getElementById('v-email'), number: document.getElementById('v-nummer') };

  const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' });
  const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Berlin' });
  const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  // Zusatzfelder der Kündigung: Grund nur bei außerordentlicher Kündigung, Datum nur auf Wunsch
  const toggle = (name, value, id) => {
    const field = document.getElementById(id);
    if (!field) return;
    const update = () => {
      field.hidden = form.querySelector(`input[name="${name}"]:checked`).value !== value;
    };
    form.querySelectorAll(`input[name="${name}"]`).forEach((input) => input.addEventListener('change', update));
    update();
  };
  toggle('art', 'ausserordentlich', 'v-grund-feld');
  toggle('wann', 'datum', 'v-datum-feld');

  // Vorausfüllen: Vertragsnummer aus der Adresse, E-Mail und Nummer aus dem Konto (falls angemeldet)
  const params = new URLSearchParams(location.search);
  if (params.get('nr')) fields.number.value = params.get('nr').slice(0, 40);
  fetch('/api/abo', { credentials: 'same-origin', cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!data) return;
      if (!fields.email.value) fields.email.value = data.email || '';
      if (!fields.number.value && data.abo) fields.number.value = data.abo.number;
    })
    .catch(() => {});

  function fail(message, focus) {
    error.textContent = message;
    if (focus) focus.focus();
  }

  function payload() {
    const body = { name: fields.name.value.trim(), email: fields.email.value.trim(), number: fields.number.value.trim() };
    if (!body.name) return fail('Bitte gib deinen Namen an.', fields.name);
    if (!looksLikeEmail(body.email)) return fail('Bitte gib die E-Mail-Adresse an, mit der du das Abo abgeschlossen hast.', fields.email);
    if (art === 'kuendigen') {
      body.art = form.querySelector('input[name="art"]:checked').value;
      const grund = document.getElementById('v-grund');
      if (body.art === 'ausserordentlich') {
        body.grund = grund.value.trim();
        if (!body.grund) return fail('Bitte nenne den Grund für die außerordentliche Kündigung.', grund);
      }
      if (form.querySelector('input[name="wann"]:checked').value === 'datum') {
        const datum = document.getElementById('v-datum');
        if (!datum.value) return fail('Bitte wähle ein Datum oder „Zum nächstmöglichen Zeitpunkt“.', datum);
        body.datum = datum.value;
      }
    }
    return body;
  }

  // Erklärung als Zeilen: so steht sie auf der Seite, in der Datei und im Ausdruck
  function lines(content, receivedAt) {
    const at = new Date(receivedAt);
    const rows = [
      ['Eingegangen am', `${dateFmt.format(at)} um ${timeFmt.format(at)} Uhr`],
      ['Erklärung', art === 'kuendigen' ? 'Ich kündige mein leaqizz Abo.' : 'Ich widerrufe meinen Vertrag über das leaqizz Abo.'],
      ['Name', content.name],
      ['E-Mail-Adresse', content.email],
    ];
    if (content.number) rows.push(['Vertragsnummer', content.number]);
    if (art === 'kuendigen') {
      rows.push(['Art', content.art === 'ausserordentlich' ? 'außerordentlich' : 'ordentlich']);
      if (content.grund) rows.push(['Grund', content.grund]);
      rows.push(['Ende', content.datum ? dateFmt.format(new Date(`${content.datum}T12:00:00Z`)) : 'zum nächstmöglichen Zeitpunkt']);
    }
    rows.push(['Abgegeben über', art === 'kuendigen' ? 'Schaltfläche „jetzt kündigen“ auf leaqizz' : 'Schaltfläche „Widerruf bestätigen“ auf leaqizz']);
    return rows;
  }

  function show(rows) {
    const dl = document.getElementById('beleg-daten');
    dl.replaceChildren(
      ...rows.flatMap(([k, v]) => {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        return [dt, dd];
      }),
    );
    form.hidden = true;
    beleg.hidden = false;
    beleg.focus();
    document.getElementById('beleg-drucken').onclick = () => window.print();
    document.getElementById('beleg-speichern').onclick = () => {
      const title = art === 'kuendigen' ? 'Kündigung leaqizz Abo' : 'Widerruf leaqizz Abo';
      const text = [title, '', ...rows.map(([k, v]) => `${k}: ${v}`), ''].join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      a.download = `${art === 'kuendigen' ? 'kuendigung' : 'widerruf'}-leaqizz-${new Date().toISOString().slice(0, 10)}.txt`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    const body = payload();
    if (!body) return;
    submit.disabled = true;
    submit.textContent = 'Wird gesendet …';
    const again = (message) => {
      submit.disabled = false;
      submit.textContent = submitLabel;
      fail(message);
    };
    let res;
    try {
      res = await fetch(`/api/vertrag/${art === 'kuendigen' ? 'kuendigen' : 'widerrufen'}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      return again('Keine Verbindung zum Server. Bitte erneut versuchen.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return again(data.error || 'Das hat nicht geklappt. Bitte erneut versuchen.');
    show(lines(data.content, data.receivedAt));
  });
})();
