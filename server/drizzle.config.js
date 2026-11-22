// Erzeugt SQL-Migrationen aus src/db/schema.js: `npm run db:generate`
export default {
  dialect: 'postgresql',
  schema: './src/db/schema.js',
  out: './drizzle',
};
