import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer loads .env files on its own. Locally we read the repo-root
// .env; in Docker/CI the variables come from the environment and this is a no-op.
loadEnv({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });

// `prisma generate` (run on install, including during image builds) needs no
// database, so the URL is optional here. Commands that connect (migrate, db)
// fail with Prisma's own clear error if it is missing.
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
