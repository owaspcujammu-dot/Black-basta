/**
 * Test environment. Imported before any application module, so the config
 * module sees these values. A test file can override one with
 * `vi.hoisted(() => { process.env.X = '…' })`, which runs even earlier.
 */
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  // In-memory PostgreSQL (PGlite): tests never touch a real database.
  DATABASE_URL: 'pglite://memory',
  JWT_SECRET: 'test-only-secret-test-only-secret-test-only-secret',
  BCRYPT_ROUNDS: '4',
  MAX_PARTICIPANTS: '110',
  FLAG_PREFIX: 'NIKA',
  FIRST_BLOOD_BONUS: '50',
  ADMIN_USERNAME: 'admin',
  // Pinned: tests must not depend on the developer's own .env.
  ADMIN_EMAIL: 'admin@blackbasta.local',
  SELF_REGISTRATION: 'true',
  MAX_TEAM_SIZE: '4',
  ADMIN_PASSWORD: 'Test-Admin-Passw0rd',
  DEMO_MODE: 'false',
  RATE_LIMIT_ENABLED: 'false',
  FRONTEND_URL: 'http://localhost:5173',
  // One directory per test process: files run in parallel and clean up after themselves.
  UPLOAD_DIR: `backend/.test-uploads/${process.pid}`,
};

const overridable = new Set(['MAX_PARTICIPANTS', 'RATE_LIMIT_ENABLED', 'FIRST_BLOOD_BONUS', 'SUBMIT_LIMIT_PER_MIN', 'SUBMIT_LIMIT_PER_CHALLENGE', 'SELF_REGISTRATION', 'MAX_TEAM_SIZE']);

for (const [key, value] of Object.entries(defaults)) {
  if (overridable.has(key) && process.env[key] !== undefined) continue;
  process.env[key] = value;
}
