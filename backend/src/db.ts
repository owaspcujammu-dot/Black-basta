import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { backendRoot, config } from './config';

/**
 * The shared Prisma client. Assigned by initDb() before the app handles requests.
 *
 * Two connection modes, chosen by DATABASE_URL:
 *   postgresql://…  → real PostgreSQL through a pooled `pg` connection (production).
 *   pglite://<dir>  → embedded PostgreSQL (PGlite) for demo mode and tests;
 *                     `pglite://memory` keeps everything in memory.
 */
export let prisma: PrismaClient;

let closeEmbedded: (() => Promise<void>) | null = null;

export function isEmbeddedDatabase(): boolean {
  return config.databaseUrl.startsWith('pglite:');
}

export async function initDb(): Promise<PrismaClient> {
  if (prisma) return prisma;

  if (isEmbeddedDatabase()) {
    if (config.isProduction) {
      throw new Error('The embedded pglite:// database is for demo mode and tests only. Use PostgreSQL in production.');
    }
    // Dev-only dependencies, loaded lazily so production images do not need them.
    const { PGlite } = await import('@electric-sql/pglite');
    const { PrismaPGlite } = await import('pglite-prisma-adapter');

    const target = config.databaseUrl.replace(/^pglite:(\/\/)?/, '');
    const dataDir = target === 'memory' || target === '' ? undefined : path.resolve(backendRoot, target);
    let releaseLock = () => {};
    if (dataDir) {
      fs.mkdirSync(path.dirname(dataDir), { recursive: true });
      // Only one server may use an embedded database at a time (two would corrupt it).
      releaseLock = acquireEmbeddedLock(`${dataDir}.lock`, dataDir);
      // Holding our own lock, a postmaster.pid can only be left over from a
      // process that was killed (e.g. a closed terminal). Left in place it
      // makes PGlite abort; PostgreSQL's normal crash recovery handles the rest.
      fs.rmSync(path.join(dataDir, 'postmaster.pid'), { force: true });
    }

    const pglite = new PGlite(dataDir);
    await pglite.waitReady;
    await applyMigrations(pglite);

    // The adapter is typed against an older @prisma/driver-adapter-utils minor;
    // the runtime contract is the same (exercised by the whole test suite).
    const adapter = new PrismaPGlite(pglite) as unknown as PrismaPg;
    prisma = new PrismaClient({ adapter });
    closeEmbedded = async () => {
      await pglite.close();
      releaseLock();
    };
  } else {
    const adapter = new PrismaPg({
      connectionString: config.databaseUrl,
      max: config.dbPoolMax,
      // Connections are opened at startup (warmPool) and kept: opening one needs the
      // same worker threads as password hashing, so during a mass login new
      // connections would queue behind hundreds of logins and time out.
      idleTimeoutMillis: 0,
      connectionTimeoutMillis: 10_000,
    });
    // Under a rush (everyone logging in at the start) transactions queue for a pool
    // connection; wait for one rather than failing after Prisma's 2 s default.
    prisma = new PrismaClient({ adapter, transactionOptions: { maxWait: 15_000, timeout: 20_000 } });
  }

  return prisma;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0: existence check only
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Takes an exclusive lock on an embedded database directory, or explains who
 * holds it. A lock left by a process that no longer exists is taken over.
 * Returns a function that releases the lock (also run automatically on exit).
 */
function acquireEmbeddedLock(lockPath: string, dataDir: string): () => void {
  const holder = Number.parseInt(fs.existsSync(lockPath) ? fs.readFileSync(lockPath, 'utf8') : '', 10);
  if (Number.isInteger(holder) && holder !== process.pid && processIsAlive(holder)) {
    throw new Error(
      [
        `The database at ${dataDir} is already in use by another running server (process ${holder}).`,
        '  Only one Black Basta API can use it at a time. Stop the other one (`npm run demo` or `npm run dev`) first.',
        `  If no other server is running, delete ${lockPath} and try again.`,
      ].join('\n'),
    );
  }
  fs.writeFileSync(lockPath, String(process.pid));
  const release = () => {
    try {
      if (fs.readFileSync(lockPath, 'utf8').trim() === String(process.pid)) fs.rmSync(lockPath, { force: true });
    } catch {
      // Already gone.
    }
  };
  process.once('exit', release);
  return release;
}

export async function closeDb(): Promise<void> {
  if (!prisma) return;
  await prisma.$disconnect();
  if (closeEmbedded) await closeEmbedded().catch(() => undefined);
}

/**
 * Applies prisma/migrations/*.sql to an embedded database.
 * (Real PostgreSQL is migrated with `prisma migrate deploy`.)
 */
async function applyMigrations(pglite: { exec(sql: string): Promise<unknown>; query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }) {
  const migrationsDir = path.join(backendRoot, 'prisma', 'migrations');
  await pglite.exec('CREATE TABLE IF NOT EXISTS "_kop_migrations" (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const applied = new Set((await pglite.query<{ name: string }>('SELECT name FROM "_kop_migrations"')).rows.map((row) => row.name));

  const pending = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !applied.has(entry.name))
    .map((entry) => entry.name)
    .sort();

  for (const name of pending) {
    const sql = fs.readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8');
    await pglite.exec(sql);
    await pglite.query('INSERT INTO "_kop_migrations" (name) VALUES ($1)', [name]);
  }
}
