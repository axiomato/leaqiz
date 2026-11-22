'use strict';

// Konto der Lehrkraft (nur mit eigenem Server): Anmeldelink per Mail und Passkey.
// Spricht direkt mit Better Auth unter /api/auth/ (kein Framework, kein Build).
// Ohne Server (GitHub Pages) ist alles abgeschaltet: enabled() === false.

window.LQAccount = (function () {
  const server = () => (window.LEAQIZ_CONFIG && window.LEAQIZ_CONFIG.server) || null;
  const enabled = () => Boolean(server());
  const url = (path) => new URL(`${server().api}auth/${path}`, location.href).href;
  const W = () => window.SimpleWebAuthnBrowser;

  const MESSAGES = {
    429: 'Zu viele Versuche. Bitte warte ein paar Minuten.',
    401: 'Bitte melde dich erneut an.',
  };

  async function call(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(url(path), {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error('Keine Verbindung zum Server. Bitte Internet prüfen.');
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* leere Antwort */
    }
    if (!res.ok) throw Object.assign(new Error(MESSAGES[res.status] || 'Das hat nicht geklappt. Bitte erneut versuchen.'), { status: res.status, code: data && data.code });
    return data;
  }

  // Angemeldete Lehrkraft oder null
  async function current() {
    if (!enabled()) return null;
    try {
      const data = await call('get-session');
      return data && data.user ? { id: data.user.id, email: data.user.email } : null;
    } catch {
      return null;
    }
  }

  function sendLink(email) {
    return call('sign-in/magic-link', {
      method: 'POST',
      body: { email, callbackURL: '/host/?angemeldet=1', errorCallbackURL: '/host/?anmeldung=fehler' },
    });
  }

  const passkeySupported = () => Boolean(window.PublicKeyCredential && W() && W().browserSupportsWebAuthn());

  // Abbruch im Dialog des Browsers ist kein Fehler, den man erklären muss
  function webauthnError(err) {
    if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) return Object.assign(new Error('Abgebrochen.'), { cancelled: true });
    if (err && err.name === 'InvalidStateError') return new Error('Auf diesem Gerät gibt es schon einen Passkey für leaqizz.');
    return err instanceof Error ? err : new Error('Passkey hat nicht geklappt.');
  }

  async function passkeySignIn() {
    const options = await call('passkey/generate-authenticate-options');
    let response;
    try {
      response = await W().startAuthentication({ optionsJSON: options });
    } catch (err) {
      throw webauthnError(err);
    }
    try {
      await call('passkey/verify-authentication', { method: 'POST', body: { response } });
    } catch (err) {
      if (err.status === 400 || err.status === 401) throw new Error('Dieser Passkey ist nicht (mehr) bei leaqizz hinterlegt. Melde dich per Mail an.');
      throw err;
    }
  }

  async function passkeyAdd() {
    const options = await call('passkey/generate-register-options');
    let response;
    try {
      response = await W().startRegistration({ optionsJSON: options });
    } catch (err) {
      throw webauthnError(err);
    }
    await call('passkey/verify-registration', { method: 'POST', body: { response, name: deviceName() } });
  }

  async function passkeys() {
    try {
      const list = await call('passkey/list-user-passkeys');
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  // Name, unter dem der Passkey in der Liste erscheint (nur grob, kein Fingerprinting)
  function deviceName() {
    const ua = navigator.userAgent;
    const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Gerät';
    return `${os}, eingerichtet am ${new Date().toLocaleDateString('de-DE')}`;
  }

  function signOut() {
    return call('sign-out', { method: 'POST', body: {} });
  }

  return { enabled, current, sendLink, passkeySupported, passkeySignIn, passkeyAdd, passkeys, signOut };
})();
