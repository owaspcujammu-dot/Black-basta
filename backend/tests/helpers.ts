import './env';
import fs from 'node:fs';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { closeDb, initDb, prisma } from '../src/db';
import { applyEventAction, resetEventCache } from '../src/services/event.service';
import { closeAllStreams } from '../src/services/realtime.service';
import { invalidateScoreboard } from '../src/services/scoreboard.service';
import { ensureBaseData, seedAdmin } from '../src/services/seed.service';
import { hashFlag, newFlagSalt } from '../src/utils/flags';

export { config, prisma, resetEventCache };

export const ADMIN = { identifier: 'admin', password: 'Test-Admin-Passw0rd' };
export const PASSWORD = 'Str0ng-Passw0rd';

let app: Express;

/** Boots a fresh in-memory database and the Express app for one test file. */
export async function setup(): Promise<Express> {
  await initDb();
  await ensureBaseData();
  await seedAdmin();
  app = createApp();
  return app;
}

export async function teardown() {
  closeAllStreams();
  await closeDb();
  fs.rmSync(config.uploadDir, { recursive: true, force: true });
}

/** A browser-like client: keeps cookies and sends the CSRF token on writes. */
export async function client() {
  const agent = request.agent(app);
  const csrf = (await agent.get('/api/auth/csrf')).body.csrfToken as string;
  return {
    agent,
    csrf,
    get: (url: string) => agent.get(url),
    post: (url: string, body?: object) => agent.post(url).set('X-CSRF-Token', csrf).send(body ?? {}),
    put: (url: string, body?: object) => agent.put(url).set('X-CSRF-Token', csrf).send(body ?? {}),
    delete: (url: string) => agent.delete(url).set('X-CSRF-Token', csrf),
  };
}

export type Client = Awaited<ReturnType<typeof client>>;

export function registration(username: string, overrides: Record<string, unknown> = {}) {
  return {
    username,
    fullName: `Pirate ${username}`,
    email: `${username.toLowerCase()}@example.test`,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    ...overrides,
  };
}

/** Registers a participant and returns a logged-in client. */
export async function registerClient(username: string): Promise<Client> {
  const c = await client();
  const response = await c.post('/api/auth/register', registration(username));
  if (response.status !== 201) throw new Error(`register ${username} failed: ${response.status} ${JSON.stringify(response.body)}`);
  return c;
}

export async function adminClient(): Promise<Client> {
  const c = await client();
  const response = await c.post('/api/auth/login', ADMIN);
  if (response.status !== 200) throw new Error(`admin login failed: ${response.status}`);
  return c;
}

export async function createChallenge(data: { title: string; flag: string; points?: number; category?: string; enabled?: boolean; hints?: { content: string; cost: number }[] }) {
  const category = await prisma.category.findFirstOrThrow({ where: { name: data.category ?? 'Web' } });
  const salt = newFlagSalt();
  return prisma.challenge.create({
    data: {
      title: data.title,
      slug: data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      description: 'Test challenge',
      categoryId: category.id,
      difficulty: 'EASY',
      points: data.points ?? 100,
      enabled: data.enabled ?? true,
      flagSalt: salt,
      flagHash: hashFlag(data.flag, salt),
      hints: { create: (data.hints ?? []).map((hint, index) => ({ ...hint, sortOrder: index })) },
    },
    include: { hints: true },
  });
}

export async function setEventState(state: 'UPCOMING' | 'LIVE' | 'PAUSED' | 'ENDED') {
  await prisma.event.update({ where: { id: 1 }, data: { state } });
  resetEventCache();
}

export async function startEvent() {
  await applyEventAction('start');
}

/** Bulk-creates participant rows directly (fast: no bcrypt, no HTTP). */
export async function insertParticipants(count: number, startAt = 1) {
  await prisma.user.createMany({
    data: Array.from({ length: count }, (_, index) => {
      const n = startAt + index;
      return {
        username: `bulk${n}`,
        usernameKey: `bulk${n}`,
        fullName: `Bulk Pirate ${n}`,
        email: `bulk${n}@example.test`,
        passwordHash: 'not-a-real-hash',
        participantNumber: n,
      };
    }),
  });
  resetEventCache();
  invalidateScoreboard();
}
