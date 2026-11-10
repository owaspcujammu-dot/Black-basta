import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dynamicValue } from '../src/utils/scoring';
import { type Client, adminClient, client, prisma, registerClient, setup, startEvent, teardown } from './helpers';

let admin: Client;

beforeAll(async () => {
  await setup();
  admin = await adminClient();
  await startEvent();
});
afterAll(teardown);

async function dynamicChallenge(title: string, flag: string) {
  const res = await admin.post('/api/admin/challenges', {
    title,
    description: 'Dynamic test challenge.',
    categoryId: 1,
    difficulty: 'MEDIUM',
    points: 500,
    scoring: 'DYNAMIC',
    minimumPoints: 100,
    decay: 3,
    flag,
  });
  expect(res.status).toBe(201);
  return res.body.challenge.id as number;
}

const scoreOf = async (username: string) => (await prisma.user.findUniqueOrThrow({ where: { usernameKey: username.toLowerCase() } })).score;

describe('dynamic scoring', () => {
  it('follows the CTFd curve: full value first, the minimum after `decay` more solves', () => {
    expect([1, 2, 3, 4, 5].map((n) => dynamicValue(500, 100, 3, n))).toEqual([500, 456, 323, 100, 100]);
    expect(dynamicValue(500, 500, 3, 9)).toBe(500);
  });

  it('every crew holds the current value: earlier solvers drop as more crews solve', async () => {
    const id = await dynamicChallenge('Falling Treasure', 'NIKA{falling}');
    const crews = await Promise.all(['Usopp', 'Franky', 'Brook', 'Jinbe'].map((name) => registerClient(name)));

    const first = await crews[0].post(`/api/challenges/${id}/submit`, { flag: 'NIKA{falling}' });
    expect(first.body).toMatchObject({ correct: true, basePoints: 500 });
    expect(await scoreOf('Usopp')).toBe(500 + first.body.firstBloodBonus);

    await crews[1].post(`/api/challenges/${id}/submit`, { flag: 'NIKA{falling}' });
    const third = await crews[2].post(`/api/challenges/${id}/submit`, { flag: 'NIKA{falling}' });
    expect(third.body.basePoints).toBe(323);

    // All three hold 323 now (Usopp keeps the first-blood bonus on top).
    expect(await scoreOf('Usopp')).toBe(323 + first.body.firstBloodBonus);
    expect(await scoreOf('Franky')).toBe(323);
    expect(await scoreOf('Brook')).toBe(323);
    expect(await prisma.scoreEvent.count({ where: { reason: 'DECAY' } })).toBe(1 + 2);

    // Participants see the current value next to the starting and minimum values.
    const card = (await crews[3].get('/api/challenges')).body.challenges.find((c: { id: number }) => c.id === id);
    expect(card).toMatchObject({ points: 323, scoring: 'DYNAMIC', initialPoints: 500, minimumPoints: 100, solves: 3 });
  });

  it('removing a solver puts the value back up for everyone else', async () => {
    const brook = await prisma.user.findUniqueOrThrow({ where: { usernameKey: 'brook' } });
    expect((await admin.delete(`/api/admin/users/${brook.id}`)).status).toBe(200);
    expect(await scoreOf('Franky')).toBe(456);
  });

  it('rejects a dynamic challenge without a sensible minimum and decay', async () => {
    const base = { title: 'Bad Curve', description: 'x', categoryId: 1, difficulty: 'EASY', points: 100, scoring: 'DYNAMIC', flag: 'NIKA{bad}' };
    expect((await admin.post('/api/admin/challenges', base)).status).toBe(400);
    expect((await admin.post('/api/admin/challenges', { ...base, minimumPoints: 200, decay: 5 })).status).toBe(400);
    expect((await admin.post('/api/admin/challenges', { ...base, minimumPoints: 50, decay: 0 })).status).toBe(400);
  });
});

describe('scoreboard freeze', () => {
  let flag: number;
  let early: Client;
  let late: Client;
  let rival: Client;

  beforeAll(async () => {
    const res = await admin.post('/api/admin/challenges', { title: 'Freeze Gold', description: 'x', categoryId: 1, difficulty: 'EASY', points: 200, flag: 'NIKA{freeze}' });
    flag = res.body.challenge.id;
    early = await registerClient('Early');
    late = await registerClient('Late');
    rival = await registerClient('Rival');
    await early.post(`/api/challenges/${flag}/submit`, { flag: 'NIKA{freeze}' });
  });

  it('from the freeze time everyone sees the board as it was then', async () => {
    // Now: after Early's solve (in beforeAll), before Late's.
    const freezeAt = new Date().toISOString();
    expect((await admin.put('/api/admin/event', { freezeAt })).status).toBe(200);
    const before = (await (await client()).get('/api/scoreboard')).body;
    expect(before.frozenAt).toBe(freezeAt);
    const lateScoreBefore = before.entries.find((e: { username: string }) => e.username === 'Late').score;

    // A solve after the freeze still counts...
    const solve = await late.post(`/api/challenges/${flag}/submit`, { flag: 'NIKA{freeze}' });
    expect(solve.body.correct).toBe(true);
    expect(await scoreOf('Late')).toBeGreaterThan(lateScoreBefore);

    // ...but the public board, ranks, graph and solver lists do not show it.
    const after = (await (await client()).get('/api/scoreboard')).body;
    expect(after.entries.find((e: { username: string }) => e.username === 'Late').score).toBe(lateScoreBefore);
    expect((await late.get('/api/auth/me')).body.user.rank).toBe(before.entries.find((e: { username: string }) => e.username === 'Late').rank);
    const history = (await (await client()).get('/api/scoreboard/history')).body;
    expect(history.frozenAt).toBe(freezeAt);
    expect(history.to).toBe(freezeAt);
    expect(history.series.map((s: { username: string }) => s.username)).not.toContain('Late');

    const rivalView = (await rival.get(`/api/challenges/${flag}`)).body.challenge;
    expect(rivalView.solves).toBe(1);
    const rivalSolvers = (await rival.get(`/api/challenges/${flag}/solves`)).body.solves.map((s: { username: string }) => s.username);
    expect(rivalSolvers).toEqual(['Early']);

    // The crew itself sees its own solve and live score; admins see everything.
    expect((await late.get(`/api/challenges/${flag}`)).body.challenge).toMatchObject({ solved: true, solves: 2 });
    expect((await late.get('/api/profile')).body.profile.score).toBe(await scoreOf('Late'));
    expect((await admin.get(`/api/challenges/${flag}`)).body.challenge.solves).toBe(2);
    expect((await (await client()).get('/api/event')).body.event).toMatchObject({ frozen: true, freezeAt });
  });

  it('the snapshot survives a restart of the cache and is replaced on reveal', async () => {
    expect((await prisma.event.findUniqueOrThrow({ where: { id: 1 } })).frozenScoreboard).not.toBeNull();

    expect((await admin.put('/api/admin/event', { freezeAt: null })).status).toBe(200);
    const revealed = (await (await client()).get('/api/scoreboard')).body;
    expect(revealed.frozenAt).toBeNull();
    expect(revealed.entries.find((e: { username: string }) => e.username === 'Late').score).toBe(await scoreOf('Late'));
    expect((await rival.get(`/api/challenges/${flag}`)).body.challenge.solves).toBe(2);
  });

  it('the freeze must be before the end time', async () => {
    const endsAt = new Date(Date.now() + 3_600_000).toISOString();
    const freezeAt = new Date(Date.now() + 7_200_000).toISOString();
    expect((await admin.put('/api/admin/event', { endsAt, freezeAt })).status).toBe(400);
  });
});
