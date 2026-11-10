import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// This event: organizers create the team accounts; sign-up is closed. Small cap to test the limit.
vi.hoisted(() => {
  process.env.SELF_REGISTRATION = 'false';
  process.env.MAX_PARTICIPANTS = '6';
});

import { ADMIN, type Client, adminClient, client, prisma, registration, setup, teardown } from './helpers';

let admin: Client;

beforeAll(async () => {
  await setup();
  admin = await adminClient();
});
afterAll(teardown);

// Team logins also name the player on the device.
const login = async (identifier: string, password: string, player = 'Luffy') => (await client()).post('/api/auth/login', { identifier, password, player });

describe('self-registration closed', () => {
  it('refuses sign-ups and tells the website', async () => {
    const res = await (await client()).post('/api/auth/register', registration('Walkin'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('REGISTRATION_CLOSED');
    expect((await (await client()).get('/api/event')).body.event.registrationOpen).toBe(false);
  });

  it('the admin still logs in with email, without a player name', async () => {
    expect((await (await client()).post('/api/auth/login', { identifier: 'admin@blackbasta.local', password: ADMIN.password })).status).toBe(200);
  });
});

describe('organizer-created teams', () => {
  it('creates a team with the organizer\'s password and never echoes it', async () => {
    const res = await admin.post('/api/admin/teams', { teams: [{ name: '  Straw   Hat  Crew ', password: 'Gomu-Gomu-2026' }] });
    expect(res.status).toBe(201);
    expect(res.body.created).toEqual([expect.objectContaining({ username: 'Straw Hat Crew', participantNumber: 1 })]);
    expect(res.body.created[0].password).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('Gomu-Gomu-2026');
  });

  it('logs in with the team name, ignoring case and extra spaces', async () => {
    for (const name of ['Straw Hat Crew', 'straw hat crew', '  STRAW   HAT CREW ']) {
      const res = await login(name, 'Gomu-Gomu-2026');
      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ username: 'Straw Hat Crew', role: 'participant', teamName: 'Straw Hat Crew' });
    }
    expect((await login('Straw Hat Crew', 'wrong-password')).status).toBe(401);
  });

  it('bulk-creates teams and generates passwords when none are given', async () => {
    const res = await admin.post('/api/admin/teams', { teams: [{ name: 'Heart Pirates' }, { name: 'Red-Hair & Co', password: '' }] });
    expect(res.status).toBe(201);
    expect(res.body.created.map((t: { participantNumber: number }) => t.participantNumber)).toEqual([2, 3]);
    for (const team of res.body.created) {
      expect(team.password).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect((await login(team.username, team.password)).status).toBe(200);
    }
  });

  it('is all-or-nothing and reports every problem by line', async () => {
    const before = await prisma.user.count();
    const res = await admin.post('/api/admin/teams', {
      teams: [{ name: 'Kid Pirates' }, { name: 'HEART PIRATES' }, { name: 'kid pirates' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TEAMS_INVALID');
    expect(res.body.error.details.problems).toEqual([
      expect.objectContaining({ line: 2, message: 'This team name already exists.' }),
      expect.objectContaining({ line: 3, message: 'Same team name as line 1.' }),
    ]);
    expect(await prisma.user.count()).toBe(before);
  });

  it('rejects unsafe team names and short passwords', async () => {
    expect((await admin.post('/api/admin/teams', { teams: [{ name: '<script>alert(1)</script>' }] })).status).toBe(400);
    expect((await admin.post('/api/admin/teams', { teams: [{ name: 'Fine Name', password: 'short' }] })).status).toBe(400);
  });

  it('respects the participant limit', async () => {
    // 3 of 6 places used: adding 4 more must fail as a whole.
    const res = await admin.post('/api/admin/teams', { teams: [{ name: 'Team Four' }, { name: 'Team Five' }, { name: 'Team Six' }, { name: 'Team Seven' }] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('REGISTRATION_FULL');
    expect(res.body.error.message).toContain('Only 3 of 6 places are left');
    expect(await prisma.user.count({ where: { role: 'participant' } })).toBe(3);
  });

  it('lets the admin set a specific password on reset', async () => {
    const team = await prisma.user.findUniqueOrThrow({ where: { usernameKey: 'heart pirates' } });
    const res = await admin.put(`/api/admin/users/${team.id}`, { resetPassword: true, password: 'Law-Room-Shambles' });
    expect(res.status).toBe(200);
    expect(res.body.temporaryPassword).toBeUndefined();
    expect((await login('Heart Pirates', 'Law-Room-Shambles')).status).toBe(200);
  });

  it('stores up to 4 member names and refuses a 5th', async () => {
    const ok = await admin.post('/api/admin/teams', {
      teams: [{ name: 'Whitebeard Crew', password: 'Gura-Gura-2026', members: ['Marco', '  Jozu ', 'Vista', 'Izo'] }],
    });
    expect(ok.status).toBe(201);
    const team = await prisma.user.findUniqueOrThrow({ where: { usernameKey: 'whitebeard crew' } });
    expect(team.members).toEqual(['Marco', 'Jozu', 'Vista', 'Izo']);

    const tooMany = await admin.put(`/api/admin/users/${team.id}`, { members: ['A', 'B', 'C', 'D', 'E'] });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.message).toContain('at most 4 players');
    const twice = await admin.put(`/api/admin/users/${team.id}`, { members: ['Marco', 'marco'] });
    expect(twice.status).toBe(400);

    const edited = await admin.put(`/api/admin/users/${team.id}`, { members: ['Marco', 'Jozu'] });
    expect(edited.body.user.members).toEqual(['Marco', 'Jozu']);
  });

  it('allows a team on at most 4 devices at once', async () => {
    const devices: Client[] = [];
    for (const player of ['Marco', 'Jozu', 'Vista', 'Izo']) {
      const device = await client();
      expect((await device.post('/api/auth/login', { identifier: 'Whitebeard Crew', password: 'Gura-Gura-2026', player })).status).toBe(200);
      devices.push(device);
    }
    const fifth = await login('Whitebeard Crew', 'Gura-Gura-2026', 'Marco');
    expect(fifth.status).toBe(403);
    expect(fifth.body.error.code).toBe('TEAM_DEVICE_LIMIT');

    // Logging out one device frees a slot, and only that device is signed out.
    await devices[0].post('/api/auth/logout');
    expect((await devices[0].get('/api/auth/me')).status).toBe(401);
    expect((await devices[1].get('/api/auth/me')).status).toBe(200);
    expect((await login('Whitebeard Crew', 'Gura-Gura-2026', 'Marco')).status).toBe(200);
  });

  it('signs out an idle device to make room', async () => {
    const team = await prisma.user.findUniqueOrThrow({ where: { usernameKey: 'whitebeard crew' } });
    const stalest = await prisma.session.findFirstOrThrow({ where: { userId: team.id }, orderBy: { lastSeenAt: 'asc' } });
    await prisma.session.update({ where: { id: stalest.id }, data: { lastSeenAt: new Date(Date.now() - 31 * 60_000) } });
    expect((await login('Whitebeard Crew', 'Gura-Gura-2026', 'Marco')).status).toBe(200);
    expect(await prisma.session.findUnique({ where: { id: stalest.id } })).toBeNull();
    expect(await prisma.session.count({ where: { userId: team.id } })).toBe(4);
  });

  it('"sign out everywhere" logs every device out', async () => {
    const team = await prisma.user.findUniqueOrThrow({ where: { usernameKey: 'whitebeard crew' } });
    const device = await client();
    // The team is full (4 devices): this login only works after signing out everywhere.
    expect((await device.post('/api/auth/login', { identifier: 'Whitebeard Crew', password: 'Gura-Gura-2026', player: 'Marco' })).status).toBe(403);

    const res = await admin.put(`/api/admin/users/${team.id}`, { signOutEverywhere: true });
    expect(res.status).toBe(200);
    expect(await prisma.session.count({ where: { userId: team.id } })).toBe(0);
    expect((await device.post('/api/auth/login', { identifier: 'Whitebeard Crew', password: 'Gura-Gura-2026', player: 'Marco' })).status).toBe(200);

    const list = await admin.get('/api/admin/users?search=whitebeard');
    // Vista and Izo were added when they first logged in.
    expect(list.body.users[0]).toMatchObject({ members: ['Marco', 'Jozu', 'Vista', 'Izo'], devices: 1 });
    expect(list.body.maxTeamSize).toBe(4);
  });

  it('deletes a team with everything it did, and frees its place', async () => {
    const made = await admin.post('/api/admin/teams', { teams: [{ name: 'Doomed Crew', password: 'Doomed-Pass-2026' }] });
    const id = made.body.created[0].id as number;
    const device = await client();
    await device.post('/api/auth/login', { identifier: 'Doomed Crew', password: 'Doomed-Pass-2026', player: 'Doomed' });
    const before = await prisma.user.count({ where: { role: 'participant' } });

    const res = await admin.delete(`/api/admin/users/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe('Doomed Crew');
    expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.session.count({ where: { userId: id } })).toBe(0);
    expect(await prisma.user.count({ where: { role: 'participant' } })).toBe(before - 1);
    expect((await device.get('/api/auth/me')).status).toBe(401);
    expect((await login('Doomed Crew', 'Doomed-Pass-2026')).status).toBe(401);
    expect((await admin.delete(`/api/admin/users/${id}`)).status).toBe(404);
  });

  it('cannot delete the admin account', async () => {
    const adminUser = await prisma.user.findFirstOrThrow({ where: { role: 'admin' } });
    expect((await admin.delete(`/api/admin/users/${adminUser.id}`)).status).toBe(403);
  });

  it('only admins can create or delete teams', async () => {
    const team = await client();
    await team.post('/api/auth/login', { identifier: 'Straw Hat Crew', password: 'Gomu-Gomu-2026', player: 'Luffy' });
    expect((await team.post('/api/admin/teams', { teams: [{ name: 'Sneaky Crew' }] })).status).toBe(403);
    const victim = await prisma.user.findUniqueOrThrow({ where: { usernameKey: 'heart pirates' } });
    expect((await team.delete(`/api/admin/users/${victim.id}`)).status).toBe(403);
    expect(await prisma.user.findUnique({ where: { id: victim.id } })).not.toBeNull();
  });
});
