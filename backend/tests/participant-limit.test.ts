import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, client, insertParticipants, prisma, registration, resetEventCache, setup, teardown } from './helpers';

beforeAll(async () => {
  await setup();
  // 108 pirates are already aboard.
  await insertParticipants(108);
});
afterAll(teardown);

describe('participant limit (110)', () => {
  it('109 → allowed', async () => {
    const res = await (await client()).post('/api/auth/register', registration('Pirate109'));
    expect(res.status).toBe(201);
    expect(res.body.participantNumber).toBe(109);
  });

  it('110 → allowed', async () => {
    const res = await (await client()).post('/api/auth/register', registration('Pirate110'));
    expect(res.status).toBe(201);
    expect(res.body.participantNumber).toBe(110);
  });

  it('111 → rejected with the "Grand Line is Full" message', async () => {
    const res = await (await client()).post('/api/auth/register', registration('Pirate111'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('REGISTRATION_FULL');
    expect(res.body.error.message).toContain('The Grand Line is Full!');
    expect(res.body.error.message).toContain('maximum capacity of 110 pirates');
    expect(await prisma.user.count({ where: { role: 'participant' } })).toBe(110);
  });

  it('reports 110 / 110 on the public event endpoint', async () => {
    const res = await (await client()).get('/api/event');
    expect(res.body.event).toMatchObject({ participants: 110, maxParticipants: 110 });
  });

  it('admins can still log in when registration is full', async () => {
    const admin = await adminClient();
    const res = await admin.get('/api/admin/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.stats).toMatchObject({ registered: 110, maxParticipants: 110 });
  });

  it('existing participants can still log in when registration is full', async () => {
    const c = await client();
    const res = await c.post('/api/auth/login', { identifier: 'Pirate110', password: registration('x').password });
    expect(res.status).toBe(200);
  });
});

describe('participant limit under concurrency', () => {
  it('never exceeds the cap when many register at once', async () => {
    // Free five berths, then let twelve pirates race for them.
    const victims = await prisma.user.findMany({ where: { usernameKey: { startsWith: 'bulk' } }, take: 5, orderBy: { id: 'desc' } });
    await prisma.user.deleteMany({ where: { id: { in: victims.map((user) => user.id) } } });
    resetEventCache();

    const clients = await Promise.all(Array.from({ length: 12 }, () => client()));
    const results = await Promise.all(clients.map((c, index) => c.post('/api/auth/register', registration(`Racer${index}`))));

    expect(results.filter((res) => res.status === 201)).toHaveLength(5);
    expect(results.filter((res) => res.status === 403)).toHaveLength(7);
    expect(await prisma.user.count({ where: { role: 'participant' } })).toBe(110);
  });
});
