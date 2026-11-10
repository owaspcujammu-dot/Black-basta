import crypto from 'node:crypto';
import fs from 'node:fs';
import type { Server } from 'node:http';
import { createApp } from './app';
import { config } from './config';
import { closeDb, initDb, isEmbeddedDatabase, prisma } from './db';
import { startEventTicker } from './services/event.service';
import { closeAllStreams } from './services/realtime.service';
import * as seed from './services/seed.service';

/** Fails fast, with instructions, when PostgreSQL is not reachable. */
async function assertDatabaseReachable(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    let where = 'the server in DATABASE_URL';
    try {
      const url = new URL(config.databaseUrl);
      where = `${url.hostname}:${url.port || 5432}`;
    } catch {
      // Unparseable URL: keep the generic wording.
    }
    // The driver code (ECONNREFUSED, ENOTFOUND, 28P01 …) says more than Prisma's message.
    const code = (error as { code?: unknown })?.code;
    const reason = typeof code === 'string' ? code : '';
    throw new Error(
      [
        `Cannot connect to PostgreSQL at ${where}.${reason ? ` (${reason})` : ''}`,
        '  • Start the database:            docker compose up -d postgres',
        '  • Or run without PostgreSQL:     npm run demo     (built-in database, no Docker needed)',
      ].join('\n'),
    );
  }
}

/** Opens the whole connection pool now, so a rush of logins never waits on new connections. */
async function warmPool(): Promise<void> {
  await Promise.all(Array.from({ length: config.dbPoolMax }, () => prisma.$queryRaw`SELECT 1 AS ok FROM pg_sleep(0.05)`));
}

export async function start(): Promise<Server> {
  await initDb();
  if (!isEmbeddedDatabase()) {
    await assertDatabaseReachable();
    await warmPool();
  }
  await seed.ensureBaseData();
  fs.mkdirSync(config.uploadDir, { recursive: true });

  if (config.demoMode) {
    // Demo credentials come from the environment, or are generated fresh for this run.
    const passwords = {
      admin: config.adminPassword ?? `Demo-${crypto.randomBytes(6).toString('base64url')}-9a`,
      participant: process.env.DEMO_PASSWORD?.trim() || `Demo-${crypto.randomBytes(6).toString('base64url')}-9a`,
    };
    await seed.seedDemoAccounts(passwords);
    console.log('\n  ┌──────────────── DEMO MODE ────────────────');
    // Passwords the organizer chose are never echoed; only generated ones are shown once.
    const shown = (generated: boolean, value: string, variable: string) => (generated ? value : `(the password in ${variable})`);
    console.log(`  │ admin        ${config.adminUsername} / ${shown(!config.adminPassword, passwords.admin, 'ADMIN_PASSWORD')}`);
    console.log(`  │ participant  demo / ${shown(!process.env.DEMO_PASSWORD?.trim(), passwords.participant, 'DEMO_PASSWORD')}`);
    console.log(config.seedDemoChallenges ? '  │ Sample challenges are seeded; each description shows its demo flag.' : '  │ No sample content: create challenges in the admin panel, then press Start CTF.');
    console.log('  └───────────────────────────────────────────\n');
  } else if (isEmbeddedDatabase()) {
    // No `prisma db seed` step exists for the embedded database, so seed here.
    await seed.seedAdmin();
    if (config.seedDemoChallenges) await seed.seedDemoChallenges();
  }

  const app = createApp();
  const ticker = startEventTicker();
  const server = app.listen(config.port, () => {
    console.log(`☠  ${config.eventName} API listening on http://localhost:${config.port}  [${config.nodeEnv}${config.demoMode ? ', demo mode' : ''}]`);
  });
  // SSE streams are long-lived; do not let the default timeouts cut them off.
  server.keepAliveTimeout = 75_000;
  server.requestTimeout = 0;

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received — lowering the sails.`);
    clearInterval(ticker);
    closeAllStreams();
    server.close(() => {
      closeDb().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}
