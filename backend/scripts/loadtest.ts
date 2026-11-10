/**
 * Load test: simulates N concurrent participants against a running instance.
 *
 *   npm run loadtest -- --url http://localhost:5000 --users 110 --rounds 5
 *
 * Each simulated pirate registers, opens the live (SSE) stream, then loops:
 * list challenges → open one → submit a wrong flag → read the scoreboard.
 *
 * Run it against a STAGING or demo instance: it creates real accounts
 * (loadNNN_xxxx) and uses up participant slots.
 */
import crypto from 'node:crypto';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1] ?? '');

const BASE = (args.get('url') ?? 'http://localhost:5000').replace(/\/+$/, '');
const USERS = Number(args.get('users') ?? 110);
const ROUNDS = Number(args.get('rounds') ?? 5);
const RUN = crypto.randomBytes(2).toString('hex');
const PASSWORD = `Load-${crypto.randomBytes(6).toString('base64url')}-9aA`;

const timings = new Map<string, number[]>();
const failures = new Map<string, number>();
let sseEvents = 0;

class Pirate {
  private cookies = new Map<string, string>();
  private csrf = '';
  constructor(readonly name: string) {}

  private async call(label: string, path: string, init: { method?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (init.method && init.method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      headers['X-CSRF-Token'] = this.csrf;
    }
    const started = performance.now();
    let status = 0;
    let body: any = null;
    try {
      const res = await fetch(BASE + path, { method: init.method ?? 'GET', headers, body: init.body ? JSON.stringify(init.body) : undefined });
      status = res.status;
      for (const cookie of res.headers.getSetCookie()) {
        const [pair] = cookie.split(';');
        const index = pair.indexOf('=');
        this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
      body = await res.json().catch(() => null);
    } catch {
      status = 0;
    }
    const elapsed = performance.now() - started;
    if (!timings.has(label)) timings.set(label, []);
    timings.get(label)!.push(elapsed);
    if (status === 0 || status >= 500 || status === 429) failures.set(`${label} → ${status || 'network error'}`, (failures.get(`${label} → ${status || 'network error'}`) ?? 0) + 1);
    return { status, body };
  }

  async board(): Promise<boolean> {
    this.csrf = (await this.call('csrf', '/api/auth/csrf')).body?.csrfToken ?? '';
    const res = await this.call('register', '/api/auth/register', {
      method: 'POST',
      body: { username: this.name, fullName: `Load Test ${this.name}`, email: `${this.name}@loadtest.invalid`, password: PASSWORD, confirmPassword: PASSWORD },
    });
    return res.status === 201;
  }

  /** Holds an SSE connection open for the duration of the test. */
  listen(signal: AbortSignal) {
    fetch(`${BASE}/api/stream`, { headers: { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }, signal })
      .then(async (res) => {
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          sseEvents += (decoder.decode(value).match(/^event: /gm) ?? []).length;
        }
      })
      .catch(() => undefined);
  }

  async voyage() {
    for (let round = 0; round < ROUNDS; round++) {
      const list = await this.call('challenges', '/api/challenges');
      const challenges: { id: number }[] = list.body?.challenges ?? [];
      if (challenges.length > 0) {
        const pick = challenges[Math.floor(Math.random() * challenges.length)];
        await this.call('challenge detail', `/api/challenges/${pick.id}`);
        await this.call('submit flag', `/api/challenges/${pick.id}/submit`, { method: 'POST', body: { flag: `NIKA{load_${crypto.randomBytes(4).toString('hex')}}` } });
      }
      await this.call('scoreboard', '/api/scoreboard');
      await this.call('profile', '/api/profile');
      await new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 600));
    }
  }
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

async function main() {
  const event: { event?: { state: string; participants: number; maxParticipants: number } } | null = await fetch(`${BASE}/api/event`)
    .then((res) => res.json() as Promise<{ event?: { state: string; participants: number; maxParticipants: number } }>)
    .catch(() => null);
  if (!event?.event) throw new Error(`No Black Basta API at ${BASE}. Start the server first.`);
  const free = event.event.maxParticipants - event.event.participants;
  const count = Math.min(USERS, free);
  console.log(`Target ${BASE} — event ${event.event.state}, ${event.event.participants}/${event.event.maxParticipants} registered.`);
  if (count < USERS) console.log(`Only ${free} berths are free: simulating ${count} pirates instead of ${USERS}.`);
  if (count <= 0) throw new Error('Registration is full; nothing to simulate.');

  const pirates = Array.from({ length: count }, (_, index) => new Pirate(`load${String(index + 1).padStart(3, '0')}_${RUN}`));
  const started = performance.now();

  console.log(`\n1/2  ${count} pirates registering at once…`);
  const boarded = await Promise.all(pirates.map((pirate) => pirate.board()));
  const crew = pirates.filter((_, index) => boarded[index]);
  console.log(`     ${crew.length}/${count} registered in ${((performance.now() - started) / 1000).toFixed(1)}s`);

  console.log(`2/2  ${crew.length} pirates holding live streams and playing ${ROUNDS} rounds…`);
  const abort = new AbortController();
  crew.forEach((pirate) => pirate.listen(abort.signal));
  await Promise.all(crew.map((pirate) => pirate.voyage()));
  abort.abort();

  const total = [...timings.values()].reduce((sum, list) => sum + list.length, 0);
  const seconds = (performance.now() - started) / 1000;
  console.log(`\n${'endpoint'.padEnd(18)}${'requests'.padStart(9)}${'median'.padStart(10)}${'p95'.padStart(10)}${'max'.padStart(10)}`);
  for (const [label, list] of timings) {
    console.log(`${label.padEnd(18)}${String(list.length).padStart(9)}${`${percentile(list, 50).toFixed(0)} ms`.padStart(10)}${`${percentile(list, 95).toFixed(0)} ms`.padStart(10)}${`${Math.max(...list).toFixed(0)} ms`.padStart(10)}`);
  }
  console.log(`\n${total} requests in ${seconds.toFixed(1)}s (${(total / seconds).toFixed(0)} req/s), ${sseEvents} live events received over ${crew.length} streams.`);

  if (failures.size === 0) {
    console.log('No server errors, network errors or rate-limit rejections.');
  } else {
    console.log('Problems:');
    for (const [label, n] of failures) console.log(`  ${label}: ${n}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
