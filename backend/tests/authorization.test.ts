import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import { type Client, adminClient, client, config, createChallenge, prisma, registerClient, setup, startEvent, teardown } from './helpers';

let app: Express;
let participant: Client;
let admin: Client;
let challengeId: number;

beforeAll(async () => {
  app = await setup();
  challengeId = (await createChallenge({ title: 'Guarded', flag: 'NIKA{guarded}' })).id;
  participant = await registerClient('Robin');
  admin = await adminClient();
  await startEvent();
});
afterAll(teardown);

const ADMIN_GETS = ['/api/admin/dashboard', '/api/admin/challenges', '/api/admin/users', '/api/admin/event'];
const PRIVATE_GETS = ['/api/auth/me', '/api/profile', '/api/challenges', '/api/announcements', '/api/categories'];

describe('unauthenticated', () => {
  it.each(PRIVATE_GETS)('cannot access %s', async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(401);
  });

  it.each(ADMIN_GETS)('cannot access %s', async (url) => {
    expect((await request(app).get(url)).status).toBe(401);
  });

  it('cannot submit flags', async () => {
    const anonymous = await client();
    expect((await anonymous.post(`/api/challenges/${challengeId}/submit`, { flag: 'NIKA{guarded}' })).status).toBe(401);
  });

  it('can read public event info and the scoreboard', async () => {
    expect((await request(app).get('/api/event')).status).toBe(200);
    expect((await request(app).get('/api/scoreboard')).status).toBe(200);
  });
});

describe('participant', () => {
  it.each(ADMIN_GETS)('cannot access %s', async (url) => {
    const res = await participant.get(url);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('cannot create, edit or delete challenges, or control the event', async () => {
    const body = { title: 'Evil', description: 'x', categoryId: 1, difficulty: 'EASY', points: 1, flag: 'NIKA{evil}' };
    expect((await participant.post('/api/admin/challenges', body)).status).toBe(403);
    expect((await participant.put(`/api/admin/challenges/${challengeId}`, body)).status).toBe(403);
    expect((await participant.delete(`/api/admin/challenges/${challengeId}`)).status).toBe(403);
    expect((await participant.post('/api/admin/event/state', { action: 'end' })).status).toBe(403);
    expect((await participant.post('/api/admin/announcements', { title: 'hi', message: 'hi' })).status).toBe(403);
    expect(await prisma.challenge.count({ where: { id: challengeId } })).toBe(1);
  });

  it('cannot read another user\'s submissions (IDOR)', async () => {
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { usernameKey: 'admin' } });
    expect((await participant.get(`/api/admin/users/${adminUser.id}/submissions`)).status).toBe(403);
  });

  it('cannot escalate with a forged or tampered token', async () => {
    const robin = await prisma.user.findUniqueOrThrow({ where: { usernameKey: 'robin' } });

    // Signed with the wrong key.
    const forged = jwt.sign({ role: 'admin', tv: 0 }, 'not-the-server-secret-not-the-server-secret', { subject: String(robin.id) });
    expect((await request(app).get('/api/admin/dashboard').set('Cookie', `kop_session=${forged}`)).status).toBe(401);

    // Unsigned ("alg: none").
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: String(robin.id), role: 'admin', tv: 0 })).toString('base64url')}.`;
    expect((await request(app).get('/api/admin/dashboard').set('Cookie', `kop_session=${none}`)).status).toBe(401);

    // Correctly signed, for Robin's real logged-in device, but claiming a role the database does not grant.
    const session = await prisma.session.findFirstOrThrow({ where: { userId: robin.id } });
    const lying = jwt.sign({ role: 'admin', tv: robin.tokenVersion, sid: session.id }, config.jwtSecret, { subject: String(robin.id) });
    expect((await request(app).get('/api/admin/dashboard').set('Cookie', `kop_session=${lying}`)).status).toBe(403);

    // Correctly signed, but for a device session that does not exist.
    const ghost = jwt.sign({ role: 'participant', tv: robin.tokenVersion, sid: 'no-such-session' }, config.jwtSecret, { subject: String(robin.id) });
    expect((await request(app).get('/api/auth/me').set('Cookie', `kop_session=${ghost}`)).status).toBe(401);
  });
});

describe('admin', () => {
  it.each(ADMIN_GETS)('can access %s', async (url) => {
    expect((await admin.get(url)).status).toBe(200);
  });

  it('never receives password hashes in the user list', async () => {
    const res = await admin.get('/api/admin/users');
    expect(res.body.users.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it('can create a challenge, and the response never echoes the flag', async () => {
    const category = await prisma.category.findFirstOrThrow({ where: { name: 'Cryptography' } });
    const res = await admin.post('/api/admin/challenges', {
      title: 'The Cipher of Gol D. Roger',
      description: 'Decrypt the will.',
      categoryId: category.id,
      difficulty: 'HARD',
      points: 350,
      flag: 'NIKA{hidden_treasure}',
      hints: [{ content: 'Think Vigenère.', cost: 30 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.challenge).toMatchObject({ title: 'The Cipher of Gol D. Roger', points: 350, enabled: true });
    expect(JSON.stringify(res.body)).not.toContain('hidden_treasure');

    const solved = await participant.post(`/api/challenges/${res.body.challenge.id}/submit`, { flag: 'NIKA{hidden_treasure}' });
    expect(solved.body.correct).toBe(true);
  });

  it('rejects a challenge whose flag is not NIKA{...}', async () => {
    const res = await admin.post('/api/admin/challenges', {
      title: 'Bad Flag',
      description: 'x',
      categoryId: 1,
      difficulty: 'EASY',
      points: 100,
      flag: 'flag{nope}',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields.flag).toContain('NIKA{...}');
  });

  it('can edit a challenge without resending the flag, and disable it', async () => {
    const category = await prisma.category.findFirstOrThrow({ where: { name: 'Web' } });
    const res = await admin.put(`/api/admin/challenges/${challengeId}`, {
      title: 'Guarded (edited)',
      description: 'Updated',
      categoryId: category.id,
      difficulty: 'MEDIUM',
      points: 200,
      flag: '',
      enabled: false,
      hints: [],
    });
    expect(res.status).toBe(200);
    expect(res.body.challenge).toMatchObject({ title: 'Guarded (edited)', enabled: false, points: 200 });
    expect((await participant.get(`/api/challenges/${challengeId}`)).status).toBe(404);
  });

  it('can disable, re-enable and reset the password of a participant', async () => {
    const victim = await registerClient('Franky');
    const user = await prisma.user.findUniqueOrThrow({ where: { usernameKey: 'franky' } });

    const disabled = await admin.put(`/api/admin/users/${user.id}`, { disabled: true });
    expect(disabled.body.user.disabled).toBe(true);
    expect((await victim.get('/api/auth/me')).status).toBe(401); // session revoked

    await admin.put(`/api/admin/users/${user.id}`, { disabled: false });
    const reset = await admin.put(`/api/admin/users/${user.id}`, { resetPassword: true });
    expect(reset.body.temporaryPassword).toEqual(expect.any(String));

    const login = await (await client()).post('/api/auth/login', { identifier: 'Franky', password: reset.body.temporaryPassword });
    expect(login.status).toBe(200);
  });

  it('cannot disable or reset an admin account through the panel', async () => {
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { usernameKey: 'admin' } });
    expect((await admin.put(`/api/admin/users/${adminUser.id}`, { disabled: true })).status).toBe(403);
  });

  it('can view a participant\'s submissions', async () => {
    const robin = await prisma.user.findUniqueOrThrow({ where: { usernameKey: 'robin' } });
    const res = await admin.get(`/api/admin/users/${robin.id}/submissions`);
    expect(res.status).toBe(200);
    expect(res.body.submissions.length).toBeGreaterThan(0);
  });

  it('controls the event: start → pause → start → end', async () => {
    const act = (action: string) => admin.post('/api/admin/event/state', { action });
    expect((await act('pause')).body.event.state).toBe('PAUSED');
    expect((await act('pause')).status).toBe(409);
    expect((await act('start')).body.event.state).toBe('LIVE');
    expect((await act('end')).body.event.state).toBe('ENDED');
    expect((await act('start')).body.event.state).toBe('LIVE');
  });

  it('publishes announcements that participants can read', async () => {
    const created = await admin.post('/api/admin/announcements', { title: 'NEW CHALLENGE RELEASED!', message: 'A new Reverse Engineering challenge has appeared.' });
    expect(created.status).toBe(201);
    const list = await participant.get('/api/announcements');
    expect(list.body.announcements[0]).toMatchObject({ title: 'NEW CHALLENGE RELEASED!' });
  });
});
