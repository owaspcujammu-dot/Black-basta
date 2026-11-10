import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, client, prisma, registration, setup, teardown } from './helpers';

beforeAll(async () => {
  await setup();
});
afterAll(teardown);

describe('registration', () => {
  it('registers a participant, assigns a pirate number and logs them in', async () => {
    const c = await client();
    const res = await c.post('/api/auth/register', registration('Shristi', { teamName: 'Straw Crew' }));

    expect(res.status).toBe(201);
    expect(res.body.participantNumber).toBe(1);
    expect(res.body.maxParticipants).toBe(110);
    expect(res.body.user).toMatchObject({ username: 'Shristi', role: 'participant', score: 0, teamName: 'Straw Crew' });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);

    const me = await c.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('Shristi');
  });

  it('stores a bcrypt hash, never the password', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { usernameKey: 'shristi' } });
    expect(user.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(user.passwordHash).not.toContain(PASSWORD);
  });

  it('sets the session cookie HttpOnly and SameSite=Strict', async () => {
    const c = await client();
    const res = await c.post('/api/auth/register', registration('CookieCheck'));
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const session = cookies.find((cookie) => cookie.startsWith('kop_session='));
    expect(session).toBeDefined();
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Strict/i);
  });

  it('rejects a duplicate username (case-insensitive)', async () => {
    const c = await client();
    const res = await c.post('/api/auth/register', registration('SHRISTI', { email: 'other@example.test' }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('USERNAME_TAKEN');
  });

  it('rejects a duplicate email (case-insensitive)', async () => {
    const c = await client();
    const res = await c.post('/api/auth/register', registration('SomeoneElse', { email: 'Shristi@Example.Test' }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it.each([
    ['too short', 'Ab1'],
    ['no uppercase', 'weakpassword1'],
    ['no number', 'WeakPassword'],
    ['no lowercase', 'WEAKPASSWORD1'],
  ])('rejects a weak password (%s)', async (_label, password) => {
    const c = await client();
    const res = await c.post('/api/auth/register', registration('WeakOne', { password, confirmPassword: password }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields.password).toBeDefined();
  });

  it('rejects mismatched password confirmation', async () => {
    const c = await client();
    const res = await c.post('/api/auth/register', registration('Mismatch', { confirmPassword: 'Different-Passw0rd' }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields.confirmPassword).toBeDefined();
  });

  it('rejects invalid usernames and emails', async () => {
    const c = await client();
    expect((await c.post('/api/auth/register', registration('bad name!'))).status).toBe(400);
    expect((await c.post('/api/auth/register', registration('GoodName', { email: 'not-an-email' }))).status).toBe(400);
  });

  it('cannot register an admin by sending a role field', async () => {
    const c = await client();
    const res = await c.post('/api/auth/register', registration('Sneaky', { role: 'admin' }));
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('participant');
  });
});

describe('login', () => {
  it('logs in with username', async () => {
    const c = await client();
    const res = await c.post('/api/auth/login', { identifier: 'shristi', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('Shristi');
  });

  it('logs in with email', async () => {
    const c = await client();
    const res = await c.post('/api/auth/login', { identifier: 'shristi@example.test', password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it('rejects a wrong password and an unknown user with the same message', async () => {
    const c = await client();
    const wrongPassword = await c.post('/api/auth/login', { identifier: 'shristi', password: 'Wrong-Passw0rd' });
    const unknownUser = await c.post('/api/auth/login', { identifier: 'nobody', password: PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body.error).toEqual(unknownUser.body.error);
    expect(wrongPassword.headers['set-cookie']?.toString() ?? '').not.toContain('kop_session=ey');
  });

  it('logout clears the session', async () => {
    const c = await client();
    await c.post('/api/auth/login', { identifier: 'shristi', password: PASSWORD });
    expect((await c.get('/api/auth/me')).status).toBe(200);
    expect((await c.post('/api/auth/logout')).status).toBe(200);
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('refuses a disabled account and voids its existing sessions', async () => {
    const c = await client();
    await c.post('/api/auth/register', registration('Marooned'));
    expect((await c.get('/api/auth/me')).status).toBe(200);

    await prisma.user.update({ where: { usernameKey: 'marooned' }, data: { disabled: true } });
    expect((await c.get('/api/auth/me')).status).toBe(403);

    const fresh = await client();
    const login = await fresh.post('/api/auth/login', { identifier: 'Marooned', password: PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe('ACCOUNT_DISABLED');
  });
});
