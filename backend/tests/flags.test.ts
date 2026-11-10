import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Client, adminClient, createChallenge, prisma, registerClient, setEventState, setup, startEvent, teardown } from './helpers';

const FLAG = 'NIKA{th3_l0st_l0g}';
let challengeId: number;
let luffy: Client;
let zoro: Client;

beforeAll(async () => {
  await setup();
  const challenge = await createChallenge({
    title: 'The Lost Log',
    flag: FLAG,
    points: 250,
    category: 'Forensics',
    hints: [{ content: 'The captain always leaves clues in hexadecimal.', cost: 25 }],
  });
  challengeId = challenge.id;
  luffy = await registerClient('Luffy');
  zoro = await registerClient('Zoro');
  await startEvent();
});
afterAll(teardown);

const submit = (c: Client, flag: string, id = challengeId) => c.post(`/api/challenges/${id}/submit`, { flag });

describe('flag submission', () => {
  it('rejects an incorrect flag without awarding points', async () => {
    const res = await submit(luffy, 'NIKA{wrong_guess}');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ correct: false, message: 'The treasure remains hidden.' });
    expect((await luffy.get('/api/auth/me')).body.user.score).toBe(0);
  });

  it('rejects the right content with the wrong prefix (flag{}, CTF{})', async () => {
    for (const flag of ['flag{th3_l0st_l0g}', 'CTF{th3_l0st_l0g}', 'nika{th3_l0st_l0g}', 'th3_l0st_l0g']) {
      const res = await submit(luffy, flag);
      expect(res.body.correct).toBe(false);
      expect(res.body.message).toBe('The treasure remains hidden.');
      expect(res.body.formatHint).toBe('Flags use the format NIKA{...}');
    }
  });

  it('gives the same answer for a near-miss as for a total miss (no partial feedback)', async () => {
    const nearMiss = await submit(zoro, 'NIKA{th3_l0st_l0G}');
    const totalMiss = await submit(zoro, 'NIKA{zzzzzzzzzzzz}');
    expect(nearMiss.body).toEqual(totalMiss.body);
  });

  it('accepts the correct flag, awards points and first blood', async () => {
    const res = await submit(luffy, `  ${FLAG}  `); // surrounding whitespace is ignored
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      correct: true,
      alreadySolved: false,
      basePoints: 250,
      firstBlood: true,
      firstBloodBonus: 50,
      pointsAwarded: 300,
      newScore: 300,
    });
    expect(res.body.achievements.map((a: { code: string }) => a.code)).toEqual(expect.arrayContaining(['SET_SAIL', 'FIRST_BLOOD']));

    const solve = await prisma.solve.findFirstOrThrow({ where: { challengeId } });
    expect(solve).toMatchObject({ points: 250, bonus: 50 });
  });

  it('does not award a duplicate solve', async () => {
    const again = await submit(luffy, FLAG);
    expect(again.body).toMatchObject({ alreadySolved: true, pointsAwarded: 0 });
    expect((await luffy.get('/api/auth/me')).body.user.score).toBe(300);
    expect(await prisma.solve.count({ where: { challengeId } })).toBe(1);
  });

  it('awards exactly once when the same flag is submitted concurrently', async () => {
    const race = await createChallenge({ title: 'Race', flag: 'NIKA{race}', points: 100 });
    const nami = await registerClient('Nami');
    const results = await Promise.all(Array.from({ length: 6 }, () => submit(nami, 'NIKA{race}', race.id)));

    expect(results.filter((res) => res.body.alreadySolved === false)).toHaveLength(1);
    expect(await prisma.solve.count({ where: { challengeId: race.id } })).toBe(1);
    expect((await nami.get('/api/auth/me')).body.user.score).toBe(150); // 100 + first blood, once
  });

  it('gives a later solver the base points but not first blood', async () => {
    const res = await submit(zoro, FLAG);
    expect(res.body).toMatchObject({ correct: true, firstBlood: false, firstBloodBonus: 0, pointsAwarded: 250 });

    const detail = await zoro.get(`/api/challenges/${challengeId}`);
    expect(detail.body.challenge.firstBlood.username).toBe('Luffy');
    expect(detail.body.challenge.solves).toBe(2);
  });

  it('never stores a correct flag in the submissions log', async () => {
    const rows = await prisma.submission.findMany({ where: { correct: true } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.submittedFlag).not.toContain('NIKA{');
  });

  it('never stores the plaintext flag on the challenge', async () => {
    const row = await prisma.challenge.findUniqueOrThrow({ where: { id: challengeId } });
    expect(JSON.stringify(row)).not.toContain(FLAG);
    expect(row.flagHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('lets an admin test a flag without recording a solve', async () => {
    const admin = await adminClient();
    const res = await submit(admin, FLAG);
    expect(res.body).toMatchObject({ correct: true, test: true });
    expect(await prisma.solve.count({ where: { challengeId } })).toBe(2);
  });

  it('returns 404 for a disabled or unknown challenge', async () => {
    const hidden = await createChallenge({ title: 'Hidden', flag: 'NIKA{hidden}', enabled: false });
    expect((await submit(luffy, 'NIKA{hidden}', hidden.id)).status).toBe(404);
    expect((await submit(luffy, 'NIKA{x}', 999999)).status).toBe(404);
    expect((await luffy.get(`/api/challenges/${hidden.id}`)).status).toBe(404);
  });
});

describe('flags are never exposed', () => {
  it('no participant or admin API response contains a flag, hash or salt', async () => {
    const admin = await adminClient();
    const responses = await Promise.all([
      luffy.get('/api/challenges'),
      luffy.get(`/api/challenges/${challengeId}`),
      luffy.get('/api/profile'),
      luffy.get('/api/scoreboard'),
      admin.get('/api/admin/challenges'),
      admin.get('/api/admin/dashboard'),
    ]);
    const row = await prisma.challenge.findUniqueOrThrow({ where: { id: challengeId } });
    for (const res of responses) {
      const body = JSON.stringify(res.body);
      expect(res.status).toBe(200);
      expect(body).not.toContain(FLAG);
      expect(body).not.toContain(row.flagHash);
      expect(body).not.toContain(row.flagSalt);
      expect(body).not.toMatch(/"flag(Hash|Salt)?"/);
    }
  });
});

describe('hints', () => {
  it('hides paid hint text until it is unlocked, then charges once', async () => {
    const before = await zoro.get(`/api/challenges/${challengeId}`);
    const hint = before.body.challenge.hints[0];
    expect(hint).toMatchObject({ cost: 25, unlocked: false, content: null });

    const unlock = await zoro.post(`/api/challenges/${challengeId}/hints/${hint.id}/unlock`);
    expect(unlock.body.hint).toMatchObject({ content: 'The captain always leaves clues in hexadecimal.', charged: 25, newScore: 225 });

    const again = await zoro.post(`/api/challenges/${challengeId}/hints/${hint.id}/unlock`);
    expect(again.body.hint.charged).toBe(0);
    expect((await zoro.get('/api/auth/me')).body.user.score).toBe(225);
  });

  it('refuses a hint the pirate cannot afford', async () => {
    const broke = await registerClient('Broke');
    const hint = (await broke.get(`/api/challenges/${challengeId}`)).body.challenge.hints[0];
    const res = await broke.post(`/api/challenges/${challengeId}/hints/${hint.id}/unlock`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_ENOUGH_BOUNTY');
    expect(JSON.stringify(res.body)).not.toContain('hexadecimal');
  });
});

describe('event state gates submissions', () => {
  it.each([
    ['PAUSED', 'EVENT_PAUSED'],
    ['ENDED', 'EVENT_ENDED'],
    ['UPCOMING', 'EVENT_UPCOMING'],
  ] as const)('blocks flag submission while %s', async (state, code) => {
    const usopp = await registerClient(`Usopp${state}`);
    await setEventState(state);
    const res = await submit(usopp, FLAG);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(code);
    await setEventState('LIVE');
  });

  it('participants can still view challenges while paused, but not before the start', async () => {
    await setEventState('PAUSED');
    const paused = await luffy.get('/api/challenges');
    expect(paused.body.locked).toBe(false);
    expect(paused.body.challenges.length).toBeGreaterThan(0);

    await setEventState('UPCOMING');
    const upcoming = await luffy.get('/api/challenges');
    expect(upcoming.body).toEqual({ locked: true, challenges: [] });
    expect((await luffy.get(`/api/challenges/${challengeId}`)).status).toBe(404);
    await setEventState('LIVE');
  });

  it('keeps the leaderboard visible after the event ends', async () => {
    await setEventState('ENDED');
    const res = await luffy.get('/api/scoreboard');
    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBeGreaterThan(0);
    await setEventState('LIVE');
  });
});
