import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

function findBackendRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'prisma', 'schema.prisma'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export const backendRoot = findBackendRoot(__dirname);
const repoRoot = path.resolve(backendRoot, '..');

// Repo-root .env first, then backend/.env. Real environment variables always win.
dotenv.config({ path: [path.join(repoRoot, '.env'), path.join(backendRoot, '.env')] });

const env = process.env;

function int(name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer (got "${raw}")`);
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function date(name: string): Date | null {
  const raw = env[name];
  if (!raw || raw.trim() === '') return null;
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) throw new Error(`${name} must be an ISO-8601 date (got "${raw}")`);
  return value;
}

const nodeEnv = env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';
const demoMode = bool('DEMO_MODE', false);

if (isProduction && demoMode) {
  throw new Error('DEMO_MODE must never be enabled when NODE_ENV=production. Unset DEMO_MODE.');
}

// --- secrets -----------------------------------------------------------------
const PLACEHOLDERS = new Set(['', 'CHANGE_ME', 'changeme', 'secret']);

let jwtSecret = env.JWT_SECRET ?? '';
if (PLACEHOLDERS.has(jwtSecret) || jwtSecret.length < 32) {
  if (isProduction) {
    throw new Error(
      'JWT_SECRET must be set to a random value of at least 32 characters in production. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
    );
  }
  // Development convenience only: sessions are invalidated on every restart.
  jwtSecret = crypto.randomBytes(48).toString('hex');
  if (nodeEnv !== 'test') {
    console.warn('[config] JWT_SECRET is missing or weak — using a temporary random secret for this run.');
  }
}

// --- database ----------------------------------------------------------------
let databaseUrl = env.DATABASE_URL ?? '';
if (!databaseUrl) {
  if (demoMode) {
    // Embedded PostgreSQL (PGlite) so demo mode needs no database server at all.
    databaseUrl = 'pglite://.demo-db';
  } else {
    throw new Error('DATABASE_URL is required (see .env.example).');
  }
}

const flagPrefix = (env.FLAG_PREFIX ?? 'NIKA').trim();
if (!/^[A-Za-z0-9_]{1,16}$/.test(flagPrefix)) {
  throw new Error('FLAG_PREFIX must be 1-16 letters, digits or underscores.');
}

const frontendOrigins = (env.FRONTEND_URL ?? 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const trustProxyRaw = (env.TRUST_PROXY ?? '').trim();
const trustProxy: boolean | number | string =
  trustProxyRaw === '' ? false : /^\d+$/.test(trustProxyRaw) ? Number(trustProxyRaw) : trustProxyRaw === 'true' ? true : trustProxyRaw === 'false' ? false : trustProxyRaw;

export const config = {
  nodeEnv,
  isProduction,
  isTest: nodeEnv === 'test',
  demoMode,
  port: int('PORT', 5000),
  databaseUrl,
  dbPoolMax: int('DB_POOL_MAX', 30),
  /** Live scoreboard pushes go out at most this often (ms); each push goes to every open browser. */
  scoreboardPushMs: Math.max(250, int('SCOREBOARD_PUSH_MS', 2000)),

  jwtSecret,
  /**
   * Key material for admin-viewable copies of flags and organizer-set team passwords.
   * Defaults to JWT_SECRET: changing either makes previously stored copies unreadable
   * (re-enter the flag / reset the password to store a new copy).
   */
  adminSecretsKey: env.ADMIN_SECRETS_KEY?.trim() || jwtSecret,
  sessionHours: int('SESSION_HOURS', 12),
  bcryptRounds: int('BCRYPT_ROUNDS', 12),
  cookieSecure: bool('COOKIE_SECURE', isProduction),
  frontendOrigins,
  trustProxy,

  eventName: env.EVENT_NAME?.trim() || 'Black Basta',
  maxParticipants: int('MAX_PARTICIPANTS', 110),
  flagPrefix,
  firstBloodBonus: Math.max(0, int('FIRST_BLOOD_BONUS', 0)),
  eventStartAt: date('EVENT_START_AT'),
  eventEndAt: date('EVENT_END_AT'),

  adminUsername: env.ADMIN_USERNAME?.trim() || 'admin',
  adminEmail: env.ADMIN_EMAIL?.trim().toLowerCase() || 'admin@blackbasta.local',
  /** Never has a default: the admin account is only created when this is set. */
  adminPassword: PLACEHOLDERS.has(env.ADMIN_PASSWORD ?? '') ? null : (env.ADMIN_PASSWORD as string),
  /** Opt-in: the eight sample challenges are only seeded when this is true. */
  seedDemoChallenges: bool('SEED_DEMO_CHALLENGES', false),
  /** When false, only admins create accounts (Admin → Pirates → Add teams); the sign-up page is closed. */
  selfRegistration: bool('SELF_REGISTRATION', true),
  /** Players per team: the most member names a team lists, and devices logged in to it at once. */
  maxTeamSize: Math.max(1, int('MAX_TEAM_SIZE', 4)),

  uploadDir: path.resolve(repoRoot, env.UPLOAD_DIR?.trim() || 'uploads'),
  maxUploadBytes: int('MAX_UPLOAD_MB', 50) * 1024 * 1024,

  rateLimitEnabled: bool('RATE_LIMIT_ENABLED', true),
  /** Flag submissions allowed per player per minute (all challenges). In team mode each team member counts separately. */
  submitLimitPerMinute: int('SUBMIT_LIMIT_PER_MIN', 10),
  /** Flag submissions allowed per player per challenge per minute. */
  submitLimitPerChallenge: int('SUBMIT_LIMIT_PER_CHALLENGE', 10),
} as const;

