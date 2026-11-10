import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Client, adminClient, client, createChallenge, prisma, registerClient, setEventState, setup, teardown } from './helpers';

// Practice section, extra accepted flags and case-insensitive flags.

let admin: Client;
let pirate: Client;
let zoro: number;

async function create(body: Record<string, unknown>) {
  return admin.post('/api/admin/challenges', { description: 'Practice test.', categoryId: 1, difficulty: 'EASY', points: 50, ...body });
}

beforeAll(async () => {
  await setup();
  admin = await adminClient();
  pirate = await registerClient('Chopper');
  const res = await create({
    title: 'The King of Hell',
    flag: 'NIKA{Roronoa_Zoro}',
    practice: true,
    flagCaseInsensitive: true,
    extraFlags: ['NIKA{Roronoa Zoro}', 'NIKA{RoronoaZoro}', 'NIKA{Zoro}'],
    hints: [{ content: 'Look at his bounty poster.', cost: 50 }],
  });
  expect(res.status).toBe(201);
  expect(res.body.challenge).toMatchObject({ practice: true, flagCaseInsensitive: true, extraFlagCount: 3 });
  zoro = res.body.challenge.id;
  // The CTF has not started: practice must still be open.
  await setEventState('UPCOMING');
});
afterAll(teardown);

describe('practice section', () => {
  it('is open before the CTF starts, while competition challenges stay sealed', async () => {
    expect((await pirate.get('/api/challenges')).body.locked).toBe(true);
    const practice = await pirate.get('/api/practice');
    expect(practice.status).toBe(200);
    expect(practice.body.challenges).toEqual([expect.objectContaining({ id: zoro, title: 'The King of Hell', practice: true, solved: false })]);
    expect((await pirate.get(`/api/challenges/${zoro}`)).body.challenge).toMatchObject({ practice: true, firstBlood: null });
    expect((await (await client()).get('/api/practice')).status).toBe(401);
  });

  it('shows practice hints for free and never charges for them', async () => {
    const detail = (await pirate.get(`/api/challenges/${zoro}`)).body.challenge;
    expect(detail.hints[0]).toMatchObject({ cost: 0, unlocked: true, content: 'Look at his bounty poster.' });
    const unlock = await pirate.post(`/api/challenges/${zoro}/hints/${detail.hints[0].id}/unlock`);
    expect(unlock.body.hint).toMatchObject({ charged: 0 });
  });

  it('accepts every listed variant ignoring capitals, and rejects the rest', async () => {
    const guess = (flag: string) => pirate.post(`/api/challenges/${zoro}/submit`, { flag });
    expect((await guess('NIKA{C4P7UR3_7H3_CR0WN}')).body.correct).toBe(false);
    expect((await guess('NIKA{Sanji}')).body.correct).toBe(false);

    const first = await guess('nika{roronoa zoro}');
    expect(first.body).toMatchObject({ correct: true, practice: true, alreadySolved: false });
    for (const variant of ['NIKA{Roronoa_Zoro}', 'NIKA{ZORO}', 'NIKA{roronoazoro}']) {
      expect((await guess(variant)).body).toMatchObject({ correct: true, practice: true, alreadySolved: true });
    }
  });

  it('never touches scores, the scoreboard, submissions or achievements', async () => {
    const team = await prisma.user.findUniqueOrThrow({ where: { usernameKey: 'chopper' } });
    expect(team).toMatchObject({ score: 0, solvedCount: 0 });
    expect(await prisma.solve.count()).toBe(0);
    expect(await prisma.submission.count()).toBe(0);
    expect(await prisma.scoreEvent.count()).toBe(0);
    expect(await prisma.userAchievement.count({ where: { userId: team.id } })).toBe(0);
    expect(await prisma.practiceSolve.count({ where: { userId: team.id, challengeId: zoro } })).toBe(1);

    const practice = (await pirate.get('/api/practice')).body.challenges[0];
    expect(practice).toMatchObject({ solved: true, solves: 1 });
    const board = (await (await client()).get('/api/scoreboard')).body.entries.find((e: { username: string }) => e.username === 'Chopper');
    expect(board).toMatchObject({ score: 0, solved: 0 });
  });

  it('keeps practice challenges out of the competition list once the CTF is live', async () => {
    await setEventState('LIVE');
    await createChallenge({ title: 'Real Gold', flag: 'NIKA{gold}' });
    const titles = (await pirate.get('/api/challenges')).body.challenges.map((c: { title: string }) => c.title);
    expect(titles).toEqual(['Real Gold']);
  });
});

describe('flag rules on competition challenges', () => {
  it('extra flags work on scored challenges too, and capitals matter unless switched off', async () => {
    const res = await create({ title: 'Twin Flags', flag: 'NIKA{Twin_One}', extraFlags: ['NIKA{Twin Two}'] });
    const id = res.body.challenge.id;
    expect((await pirate.post(`/api/challenges/${id}/submit`, { flag: 'NIKA{twin_one}' })).body.correct).toBe(false);
    expect((await pirate.post(`/api/challenges/${id}/submit`, { flag: 'NIKA{Twin Two}' })).body).toMatchObject({ correct: true, basePoints: 50 });
  });

  it('rejects malformed extra flags and too many of them', async () => {
    expect((await create({ title: 'Bad Extra', flag: 'NIKA{ok}', extraFlags: ['NIKA{a{b}'] })).status).toBe(400);
    expect((await create({ title: 'Bad Extra 2', flag: 'NIKA{ok}', extraFlags: ['zoro'] })).status).toBe(400);
    const many = Array.from({ length: 21 }, (_, i) => `NIKA{x${i}}`);
    expect((await create({ title: 'Too Many', flag: 'NIKA{ok}', extraFlags: many })).status).toBe(400);
  });

  it('changing whether capitals matter requires re-entering the flags', async () => {
    const res = await create({ title: 'Case Change', flag: 'NIKA{Case}', extraFlags: ['NIKA{Case Two}'] });
    const id = res.body.challenge.id;
    const base = { title: 'Case Change', description: 'x', categoryId: 1, difficulty: 'EASY', points: 50, flagCaseInsensitive: true };
    expect((await admin.put(`/api/admin/challenges/${id}`, base)).status).toBe(400);
    expect((await admin.put(`/api/admin/challenges/${id}`, { ...base, flag: 'NIKA{Case}' })).status).toBe(400);
    const ok = await admin.put(`/api/admin/challenges/${id}`, { ...base, flag: 'NIKA{Case}', extraFlags: ['NIKA{Case Two}'] });
    expect(ok.status).toBe(200);
    expect((await pirate.post(`/api/challenges/${id}/submit`, { flag: 'nika{case two}' })).body.correct).toBe(true);
  });

  it('a challenge crews already scored on cannot become practice', async () => {
    const real = await prisma.challenge.findFirstOrThrow({ where: { title: 'Twin Flags' } });
    const res = await admin.put(`/api/admin/challenges/${real.id}`, {
      title: 'Twin Flags',
      description: 'x',
      categoryId: 1,
      difficulty: 'EASY',
      points: 50,
      practice: true,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HAS_SOLVES');
  });
});
