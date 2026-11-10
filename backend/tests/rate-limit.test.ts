import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// This file runs with rate limiting ON and deliberately small limits.
vi.hoisted(() => {
  process.env.RATE_LIMIT_ENABLED = 'true';
  process.env.SUBMIT_LIMIT_PER_CHALLENGE = '3';
  process.env.SUBMIT_LIMIT_PER_MIN = '7';
});

import { type Client, client, createChallenge, prisma, registerClient, setup, startEvent, teardown } from './helpers';

let first: number;
let second: number;
let third: number;
let pirate: Client;

beforeAll(async () => {
  await setup();
  first = (await createChallenge({ title: 'First', flag: 'NIKA{first}' })).id;
  second = (await createChallenge({ title: 'Second', flag: 'NIKA{second}' })).id;
  third = (await createChallenge({ title: 'Third', flag: 'NIKA{third}' })).id;
  pirate = await registerClient('Brook');
  await startEvent();
});
afterAll(teardown);

const guess = (c: Client, id: number, n: number) => c.post(`/api/challenges/${id}/submit`, { flag: `NIKA{guess_${n}}` });

describe('flag brute-force protection', () => {
  it('throttles repeated guesses on one challenge', async () => {
    for (let n = 0; n < 3; n++) expect((await guess(pirate, first, n)).status).toBe(200);

    const blocked = await guess(pirate, first, 99);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('a throttled request is never evaluated — even the correct flag is refused', async () => {
    const res = await pirate.post(`/api/challenges/${first}/submit`, { flag: 'NIKA{first}' });
    expect(res.status).toBe(429);
    expect(await prisma.solve.count()).toBe(0);
    // Only the three allowed guesses reached the database.
    expect(await prisma.submission.count()).toBe(3);
  });

  it('also caps total submissions per pirate across challenges', async () => {
    // Five requests so far (three evaluated, two throttled) — throttled ones count too.
    expect((await guess(pirate, second, 1)).status).toBe(200); // 6th
    expect((await guess(pirate, second, 2)).status).toBe(200); // 7th
    expect((await guess(pirate, third, 1)).status).toBe(429); // 8th: over the per-minute cap of 7
  });

  it('limits are per account: another pirate is unaffected', async () => {
    const other = await registerClient('Jinbe');
    expect((await guess(other, first, 1)).status).toBe(200);
  });

  it('cannot be bypassed by spoofing X-Forwarded-For', async () => {
    const res = await pirate.agent
      .post(`/api/challenges/${first}/submit`)
      .set('X-CSRF-Token', pirate.csrf)
      .set('X-Forwarded-For', '203.0.113.77')
      .send({ flag: 'NIKA{first}' });
    expect(res.status).toBe(429);
  });
});

describe('login brute-force protection', () => {
  it('locks out repeated failures for one account, but not a correct login elsewhere', async () => {
    const attacker = await client();
    let last = 0;
    for (let n = 0; n < 11; n++) {
      last = (await attacker.post('/api/auth/login', { identifier: 'Brook', password: `Wrong-Passw0rd-${n}` })).status;
    }
    expect(last).toBe(429);

    // A different account from the same address is still served.
    const other = await attacker.post('/api/auth/login', { identifier: 'Jinbe', password: 'Wrong-Passw0rd' });
    expect(other.status).toBe(401);
  });
});
