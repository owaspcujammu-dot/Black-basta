import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Client, PASSWORD, adminClient, client, createChallenge, prisma, registerClient, setup, teardown } from './helpers';

let admin: Client;
let pirate: Client;
let categoryId: number;

beforeAll(async () => {
  await setup();
  admin = await adminClient();
  pirate = await registerClient('Usopp');
  categoryId = (await prisma.category.findFirstOrThrow({ where: { name: 'Web' } })).id;
});
afterAll(teardown);

const base = { description: 'x', difficulty: 'EASY', points: 100, enabled: true, practice: false, hints: [] };

describe('admin can view flags', () => {
  let id: number;

  it('shows the main and extra flags exactly as entered; the database keeps no plain text', async () => {
    const res = await admin.post('/api/admin/challenges', {
      ...base, title: 'Viewable', categoryId, flag: 'NIKA{Gomu_Gomu}', flagCaseInsensitive: true, extraFlags: ['NIKA{Roronoa Zoro}'],
    });
    expect(res.status).toBe(201);
    expect(res.body.challenge.flagViewable).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('Gomu_Gomu');
    id = res.body.challenge.id;

    const flags = await admin.get(`/api/admin/challenges/${id}/flags`);
    expect(flags.status).toBe(200);
    expect(flags.body).toMatchObject({ flag: 'NIKA{Gomu_Gomu}', extraFlags: ['NIKA{Roronoa Zoro}'], flagCaseInsensitive: true });
    expect(flags.headers['cache-control']).toBe('no-store');

    const row = await prisma.challenge.findUniqueOrThrow({ where: { id }, include: { extraFlags: true } });
    expect(JSON.stringify(row)).not.toContain('Gomu_Gomu');
    expect(JSON.stringify(row)).not.toContain('Roronoa Zoro');
  });

  it('follows a changed flag, and the old one stops working', async () => {
    const current = (await admin.get('/api/admin/challenges')).body.challenges.find((c: { id: number }) => c.id === id);
    const res = await admin.put(`/api/admin/challenges/${id}`, {
      ...base, title: current.title, categoryId, flag: 'NIKA{Gear_5}', flagCaseInsensitive: true, scoring: 'STATIC', extraFlags: [],
    });
    expect(res.status).toBe(200);
    expect((await admin.get(`/api/admin/challenges/${id}/flags`)).body).toMatchObject({ flag: 'NIKA{Gear_5}', extraFlags: [] });
    expect((await admin.post(`/api/challenges/${id}/submit`, { flag: 'nika{gear_5}' })).body.correct).toBe(true);
    expect((await admin.post(`/api/challenges/${id}/submit`, { flag: 'NIKA{Gomu_Gomu}' })).body.correct).toBe(false);
  });

  it('returns null for flags saved before flags were viewable', async () => {
    const old = await createChallenge({ title: 'Old One', flag: 'NIKA{old}' });
    expect((await admin.get('/api/admin/challenges')).body.challenges.find((c: { id: number }) => c.id === old.id).flagViewable).toBe(false);
    expect((await admin.get(`/api/admin/challenges/${old.id}/flags`)).body.flag).toBeNull();
  });

  it('is admin-only', async () => {
    expect((await pirate.get(`/api/admin/challenges/${id}/flags`)).status).toBe(403);
    expect((await (await client()).get(`/api/admin/challenges/${id}/flags`)).status).toBe(401);
  });
});

describe('admin can view team passwords', () => {
  it('shows organizer-chosen and generated team passwords', async () => {
    const res = await admin.post('/api/admin/teams', { teams: [{ name: 'Straw Hats', password: 'Sunny-Go-2026', members: ['Luffy'] }, { name: 'Heart Pirates', members: ['Law'] }] });
    expect(res.status).toBe(201);
    const [straw, heart] = res.body.created;
    expect((await admin.get(`/api/admin/users/${straw.id}/password`)).body.password).toBe('Sunny-Go-2026');
    expect((await admin.get(`/api/admin/users/${heart.id}/password`)).body.password).toBe(heart.password);

    const listed = (await admin.get('/api/admin/users?search=Straw')).body.users[0];
    expect(listed.passwordViewable).toBe(true);
    expect(JSON.stringify(listed)).not.toContain('Sunny-Go-2026');
    expect(listed.passwordSecret).toBeUndefined();
  });

  it('follows a password reset (chosen or random)', async () => {
    const team = await prisma.user.findFirstOrThrow({ where: { username: 'Straw Hats' } });
    await admin.put(`/api/admin/users/${team.id}`, { resetPassword: true, password: 'Thousand-Sunny-9' });
    expect((await admin.get(`/api/admin/users/${team.id}/password`)).body.password).toBe('Thousand-Sunny-9');
    const random = await admin.put(`/api/admin/users/${team.id}`, { resetPassword: true });
    expect((await admin.get(`/api/admin/users/${team.id}/password`)).body.password).toBe(random.body.temporaryPassword);
  });

  it('never shows self-chosen passwords or the admin password', async () => {
    const usopp = await prisma.user.findFirstOrThrow({ where: { username: 'Usopp' } });
    const res = await admin.get(`/api/admin/users/${usopp.id}/password`);
    expect(res.status).toBe(200);
    expect(res.body.password).toBeNull();
    expect(JSON.stringify(await prisma.user.findUniqueOrThrow({ where: { id: usopp.id } }))).not.toContain(PASSWORD);
    const adminRow = await prisma.user.findFirstOrThrow({ where: { role: 'admin' } });
    expect((await admin.get(`/api/admin/users/${adminRow.id}/password`)).status).toBe(403);
  });

  it('is admin-only', async () => {
    const team = await prisma.user.findFirstOrThrow({ where: { username: 'Straw Hats' } });
    expect((await pirate.get(`/api/admin/users/${team.id}/password`)).status).toBe(403);
  });
});
