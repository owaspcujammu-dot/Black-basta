/**
 * Demo mode launcher:  npm run demo
 *
 * Starts the API with DEMO_MODE on and an embedded PostgreSQL (PGlite) — no
 * Docker and no database server required. Creates an admin and a `demo`
 * participant (no sample content), then prints the logins.
 *
 * The database lives OUTSIDE the project folder, in the user's local app-data
 * directory. Cloud-sync tools (OneDrive, Dropbox, iCloud) replace files in
 * synced folders with placeholders, which the embedded database cannot open.
 *   Windows:      %LOCALAPPDATA%\black-basta\demo-db
 *   macOS/Linux:  ~/.local/share/black-basta/demo-db
 * Override with DEMO_DATABASE_URL=pglite://<directory>.
 *
 * Demo mode refuses to start when NODE_ENV=production.
 */
import os from 'node:os';
import path from 'node:path';

function defaultDemoDir(): string {
  const base = process.platform === 'win32' ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local') : path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'black-basta', 'demo-db');
}

process.env.DEMO_MODE = 'true';
process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'production' : 'development';
// Always the embedded database, even if .env points at a real PostgreSQL.
process.env.DATABASE_URL = process.env.DEMO_DATABASE_URL ?? `pglite://${defaultDemoDir()}`;
console.log(`[demo] database: ${process.env.DATABASE_URL.replace(/^pglite:\/\//, '')}`);

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('../src/server');
