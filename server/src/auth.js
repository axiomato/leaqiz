// Anmeldung der Lehrkräfte mit Better Auth: Anmeldelink per Mail und Passkey.
// Kein Passwort, keine Social Logins. Schüler:innen bekommen nie ein Konto.
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins/magic-link';
import { passkey } from '@better-auth/passkey';
import * as schema from './db/schema.js';
import { magicLinkMail } from './mail.js';

export const AUTH_BASE = '/api/auth';
export const LINK_MINUTES = 15;
// Interner Kopf für die Client-IP (Ratenbegrenzung von Better Auth). Wird bei jeder Anfrage neu gesetzt.
export const IP_HEADER = 'x-leaqiz-client-ip';

export function createAuth({ config, db, mailer }) {
  const origin = new URL(config.origin);
  return betterAuth({
    appName: 'leaqizz',
    baseURL: config.origin,
    basePath: AUTH_BASE,
    secret: config.authSecret,
    trustedOrigins: [config.origin],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification, passkey: schema.passkey },
    }),
    emailAndPassword: { enabled: false },
    telemetry: { enabled: false },
    session: {
      // 30 Tage angemeldet, bei Nutzung täglich verlängert
      expiresIn: 30 * 86_400,
      updateAge: 86_400,
    },
    // Datensparsam: IP-Adresse und Browserkennung nicht in der Sitzung speichern
    // (die Ratenbegrenzung nutzt die IP nur im Speicher)
    databaseHooks: {
      session: {
        create: { before: async (data) => ({ data: { ...data, ipAddress: null, userAgent: null } }) },
        update: { before: async (data) => ({ data: { ...data, ipAddress: null, userAgent: null } }) },
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/magic-link': { window: 600, max: 5 },
        '/magic-link/verify': { window: 60, max: 20 },
        '/passkey/verify-authentication': { window: 60, max: 20 },
      },
    },
    advanced: {
      cookiePrefix: 'leaqizz',
      useSecureCookies: origin.protocol === 'https:',
      ipAddress: { ipAddressHeaders: [IP_HEADER] },
    },
    plugins: [
      magicLink({
        expiresIn: LINK_MINUTES * 60,
        storeToken: 'hashed',
        sendMagicLink: async ({ email, url }) => {
          await mailer.send({ to: email, ...magicLinkMail(url, LINK_MINUTES) });
        },
      }),
      passkey({
        rpID: origin.hostname,
        rpName: 'leaqizz',
        origin: config.origin,
      }),
    ],
  });
}

// Fastify-Anfrage → Web-Request für Better Auth. Die Adresse kommt aus der Konfiguration, nicht aus dem Host-Header.
export function toWebRequest(request, config) {
  const url = new URL(request.url, config.origin);
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined || key === IP_HEADER) continue;
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else headers.set(key, String(value));
  }
  headers.set(IP_HEADER, request.ip || 'unbekannt');
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body !== undefined;
  return new Request(url, {
    method: request.method,
    headers,
    body: hasBody ? (typeof request.body === 'string' ? request.body : JSON.stringify(request.body)) : undefined,
  });
}

export function sessionHeaders(request) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else headers.set(key, String(value));
  }
  return headers;
}
