/**
 * Entry point. The application is loaded lazily so that configuration errors
 * (missing JWT_SECRET, DEMO_MODE in production, …) are reported as one clear
 * line instead of a stack trace.
 */
function fail(error: unknown): never {
  console.error(`\n[fatal] ${error instanceof Error ? error.message : String(error)}\n`);
  if (process.env.DEBUG) console.error(error);
  process.exit(1);
}

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { start } = require('./bootstrap') as typeof import('./bootstrap');
  start().catch(fail);
} catch (error) {
  fail(error);
}
