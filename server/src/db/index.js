// Verbindung zu PostgreSQL und Migrationen beim Start.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from './schema.js';

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

export async function openDb(databaseUrl, { max = 10 } = {}) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30_000 });
  // Fehler einer ruhenden Verbindung (z. B. Datenbank-Neustart) dürfen den Server nicht beenden
  pool.on('error', (err) => console.error('PostgreSQL:', err.message));
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    migrate: () => migrate(db, { migrationsFolder: MIGRATIONS }),
    async ping() {
      await pool.query('select 1');
      return true;
    },
    close: () => pool.end(),
  };
}
