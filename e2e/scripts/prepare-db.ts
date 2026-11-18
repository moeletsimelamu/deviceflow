import { spawnSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';

/*
 * Rebuilds the end-to-end database: drop, create, apply every migration, load the
 * demo data. Run by playwright.config.ts before it starts the API, with
 * DATABASE_URL pointing at the e2e database and SEED_DEFAULT_PASSWORD set to the
 * run's password.
 *
 * Guard: it refuses any database whose name does not end in "_e2e", so it can
 * never drop the development or test database by mistake.
 */

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const target = new URL(url);
const database = decodeURIComponent(target.pathname.replace(/^\//, ''));
if (!/^[A-Za-z0-9_]+_e2e$/.test(database)) {
  throw new Error(`Refusing to rebuild "${database}": the e2e database name must end in _e2e.`);
}

const admin = new URL(url);
admin.pathname = '/postgres';
const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
try {
  // The name was checked against a strict pattern above, so quoting it is safe.
  await client.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${database}"`);
} finally {
  await client.end();
}

const apiDir = path.resolve(import.meta.dirname, '../../apps/api');
function run(command: string) {
  const result = spawnSync(command, { cwd: apiDir, stdio: 'inherit', shell: true });
  if (result.status !== 0) throw new Error(`"${command}" failed with exit code ${result.status}`);
}

run('npx prisma migrate deploy');
run('npx tsx --conditions=source prisma/seed.ts');
console.log(`e2e database ${database} is ready.`);
