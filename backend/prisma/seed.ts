/**
 * Database seed: event row, categories, achievements, the admin account and
 * (when the challenge table is empty) eight DEMO challenges.
 *
 *   npx prisma db seed        or        npm run db:seed
 *
 * Idempotent — safe to run on every deploy.
 * The admin password is read from ADMIN_PASSWORD and is never hardcoded.
 */
import { config } from '../src/config';
import { closeDb, initDb } from '../src/db';
import * as seed from '../src/services/seed.service';

async function main() {
  await initDb();
  await seed.ensureBaseData();
  console.log('✔ event, categories and achievements are in place');

  const admin = await seed.seedAdmin();
  if (admin === 'skipped') {
    console.warn('⚠ ADMIN_PASSWORD is not set (or still CHANGE_ME): no admin account was created.');
    console.warn('  Set ADMIN_PASSWORD in .env and run the seed again.');
  } else {
    console.log(`✔ admin account "${config.adminUsername}" ${admin}`);
  }

  if (config.seedDemoChallenges) {
    const created = await seed.seedDemoChallenges();
    if (created > 0) {
      console.log(`✔ ${created} DEMO challenges created${config.isProduction ? ' (disabled — production)' : ''}`);
      console.log('  Their flags (NIKA{demo_..._flag}) are public. Replace them before a real event.');
    } else {
      console.log('✔ challenges already exist — demo challenges not added');
    }
  }

  await closeDb();
}

main().catch((error) => {
  console.error('Seed failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
