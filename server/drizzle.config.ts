import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: './data/bookmarks.db',
  },
  verbose: true,
  strict: true,
} satisfies Config;
