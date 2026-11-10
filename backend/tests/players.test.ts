import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Team mode with rate limiting ON and a small per-player limit.
vi.hoisted(() => {
  process.env.SELF_REGISTRATION = 'false';
  process.env.RATE_LIMIT_ENABLED = 'true';
  process.env.SUBMIT_LIMIT_PER_MIN = '3';
  process.env.SUBMIT_LIMIT_PER_CHALLENGE = '10';
});

import { type Client, adminClient, client, createChallenge, prisma, setup, startEvent, teardown } from './helpers';

const TEAM = { identifier: 'Straw Hat Crew', password: 'Gomu-Gomu-2026' };

let admin: Client;
let gold: number;
let silver: number;
let hinted: number;
let hintId: number;

beforeAll(async () => {
  await setup();
  admin = await adminClient();
  await admin.post('/api/admin/teams', { teams: [{ name: TEAM.identifier, password: TEAM.password, members: ['Luffy', 'Zoro', 'Nami'] }] });
  gold = (await createChallenge({ title: 'Gold', flag: 'NIKA{gold}', points: 300 })).id;
  silver = (await createChallenge({ title: 'Silver', flag: 'NIKA{silver}', points: 100 })).id;
  hinted = (await createChallenge({ title: 'Hinted', flag: 'NIKA{hinted}', points: 50, hints: [{ content: 'Look closer', cost: 20 }] })).id;
  hintId = (await prisma.hint.findFirstOrThrow({ where: { challengeId: hinted } })).id;
  await startEvent();
});
afterAll(teardown);

async function player(name?: string): Promise<Client> {
  const device = await client();
  const res = await device.post('/api/auth/login', { ...TEAM, player: name });
  expect(res.status).toBe(200);
  return device;
}

describe('player names at login', () => {
  it('a team login must say which player is on the device', async () => {
    const res = await (await client()).post('/api/auth/login', TEAM);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PLAYER_REQUIRED');
  });

  it('matches a listed player regardless of capitalisation and remembers them', async () => {
    const device = await client();
    const res = await device.post('/api/auth/login', { ...TEAM, player: '  zORO ' });
    expect(res.status).toBe(200);
    expect(res.body.user.player).toBe('Zoro');
    expect((await device.get('/api/auth/me')).body.user.player).toBe('Zoro');
    await device.post('/api/auth/logout');
  });

  it('adds a new player while the team has a free place, then refuses strangers', async () => {
    const device = await player('Sanji');
    await device.post('/api/auth/logout');
    expect((await prisma.user.findUniqueOrThrow({ where: { usernameKey: 'straw hat crew' } })).members).toEqual(['Luffy', 'Zoro', 'Nami', 'Sanji']);

    const res = await (await client()).post('/api/auth/login', { ...TEAM, player: 'Buggy' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PLAYER_NOT_ON_TEAM');
    expect(res.body.error.message).toContain('Luffy, Zoro, Nami, Sanji');
  });

  it('rejects unsafe player names', async () => {
    const res = await (await client()).post('/api/auth/login', { ...TEAM, player: '<img src=x>' });
    expect(res.status).toBe(400);
  });
});

describe('points per player', () => {
  it('credits each solve and hint to the player who made it', async () => {
    const luffy = await player('Luffy');
    const zoro = await player('Zoro');
    expect((await luffy.post(`/api/challenges/${gold}/submit`, { flag: 'NIKA{gold}' })).body.correct).toBe(true);
    expect((await zoro.post(`/api/challenges/${silver}/submit`, { flag: 'NIKA{silver}' })).body.correct).toBe(true);
    expect((await zoro.post(`/api/challenges/${hinted}/hints/${hintId}/unlock`)).status).toBe(200);

    // The whole team shares the solve: Zoro sees that Luffy claimed Gold.
    const detail = await zoro.get(`/api/challenges/${gold}`);
    expect(detail.body.challenge).toMatchObject({ solved: true, solvedBy: 'Luffy' });
    const list = await zoro.get('/api/challenges');
    expect(list.body.challenges.find((c: { id: number }) => c.id === silver).solvedBy).toBe('Zoro');

    const board = await (await client()).get('/api/scoreboard');
    const team = board.body.entries.find((entry: { username: string }) => entry.username === 'Straw Hat Crew');
    // Team score 300 + 100 - 20; first-blood bonuses are 0 in tests unless configured.
    expect(team.score).toBe(team.players.reduce((sum: number, p: { score: number }) => sum + p.score, 0));
    expect(team.players).toEqual([
      { name: 'Luffy', score: expect.any(Number), solved: 1 },
      { name: 'Zoro', score: expect.any(Number), solved: 1 },
      { name: 'Nami', score: 0, solved: 0 },
      { name: 'Sanji', score: 0, solved: 0 },
    ]);
    const zoroScore = team.players.find((p: { name: string }) => p.name === 'Zoro').score;
    const luffyScore = team.players.find((p: { name: string }) => p.name === 'Luffy').score;
    expect(luffyScore - zoroScore).toBe(300 - 100 + 20);

    const profile = await zoro.get('/api/profile');
    expect(profile.body.profile.player).toBe('Zoro');
    expect(profile.body.profile.players.map((p: { name: string }) => p.name)).toEqual(['Luffy', 'Zoro', 'Nami', 'Sanji']);
    expect(profile.body.profile.solves.find((s: { title: string }) => s.title === 'Gold').solvedBy).toBe('Luffy');

    const users = await admin.get('/api/admin/users?search=straw');
    expect(users.body.users[0].players).toEqual(team.players);

    const solves = (await admin.get('/api/admin/export/solves')).text;
    expect(solves).toContain(',Straw Hat Crew,Luffy,');
    expect(solves).toContain(',Straw Hat Crew,Zoro,');

    // Free the devices (a team may be logged in on at most 4 at once).
    await luffy.post('/api/auth/logout');
    await zoro.post('/api/auth/logout');
  });
});

describe('flag limit per player', () => {
  it('each player has their own allowance per minute', async () => {
    const nami = await player('Nami');
    const sanji = await player('Sanji');
    const guess = (device: Client, n: number) => device.post(`/api/challenges/${hinted}/submit`, { flag: `NIKA{guess_${n}}` });

    for (let n = 0; n < 3; n++) expect((await guess(nami, n)).status).toBe(200);
    const blocked = await guess(nami, 99);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.message).toContain('at most 3 flags a minute');

    // A teammate on another device is not affected.
    expect((await guess(sanji, 1)).status).toBe(200);

    // Logging in again as the same player does not reset the allowance.
    const namiAgain = await player('nami');
    expect((await guess(namiAgain, 5)).status).toBe(429);
  });
});

describe('removing a player', () => {
  it('logs that player out; teammates stay logged in', async () => {
    const team = (await admin.post('/api/admin/teams', { teams: [{ name: 'Kuja Crew', password: 'Snake-Pass-2026', members: ['Hancock', 'Marigold'] }] })).body.created[0];
    const login = async (name: string) => {
      const device = await client();
      expect((await device.post('/api/auth/login', { identifier: 'Kuja Crew', password: 'Snake-Pass-2026', player: name })).status).toBe(200);
      return device;
    };
    const hancock = await login('Hancock');
    const marigold = await login('Marigold');

    expect((await admin.put(`/api/admin/users/${team.id}`, { members: ['Hancock'] })).status).toBe(200);
    expect((await marigold.get('/api/auth/me')).status).toBe(401);
    expect((await hancock.get('/api/auth/me')).status).toBe(200);
  });
});
