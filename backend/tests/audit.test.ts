import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Client, adminClient, client, createChallenge, prisma, registerClient, resetEventCache, setup, teardown } from './helpers';

// Fixes from the security review, and the score graph / solver list features.

let admin: Client;
let gold: number;

beforeAll(async () => {
  await setup();
  admin = await adminClient();
  gold = (await createChallenge({ title: 'Gold', flag: 'NIKA{gold}', points: 300 })).id;
});
afterAll(teardown);

async function schedule(state: 'UPCOMING' | 'LIVE', startsAt: Date | null, endsAt: Date | null) {
  await prisma.event.update({ where: { id: 1 }, data: { state, startsAt, endsAt, startedAt: state === 'LIVE' ? new Date(Date.now() - 60_000) : null, endedAt: null } });
  resetEventCache();
}

describe('event schedule is enforced to the second', () => {
  it('opens the challenges at the scheduled start time without waiting for an admin', async () => {
    await schedule('UPCOMING', new Date(Date.now() - 1000), new Date(Date.now() + 3_600_000));
    const pirate = await registerClient('Early');
    const list = await pirate.get('/api/challenges');
    expect(list.body.locked).toBe(false);
    expect((await pirate.get('/api/event')).body.event.state).toBe('LIVE');
  });

  it('refuses a flag the moment the end time passes, even before the background check runs', async () => {
    await schedule('LIVE', new Date(Date.now() - 3_600_000), new Date(Date.now() - 500));
    const pirate = await registerClient('Late');
    const res = await pirate.post(`/api/challenges/${gold}/submit`, { flag: 'NIKA{gold}' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EVENT_ENDED');
    expect(await prisma.solve.count()).toBe(0);
  });

  it('a reset does not restart itself from a start time that has already passed', async () => {
    await schedule('LIVE', new Date(Date.now() - 3_600_000), new Date(Date.now() + 3_600_000));
    expect((await admin.post('/api/admin/event/state', { action: 'reset' })).status).toBe(200);
    const pirate = await registerClient('AfterReset');
    expect((await pirate.get('/api/challenges')).body.locked).toBe(true);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: 1 } })).startsAt).toBeNull();
  });
});

describe('score graph and solver list', () => {
  it('records who solved a challenge, first blood first, and the score over time', async () => {
    await schedule('LIVE', null, null);
    const zoro = await registerClient('Zoro');
    const nami = await registerClient('Nami');
    expect((await zoro.post(`/api/challenges/${gold}/submit`, { flag: 'NIKA{gold}' })).body.correct).toBe(true);
    expect((await nami.post(`/api/challenges/${gold}/submit`, { flag: 'NIKA{gold}' })).body.correct).toBe(true);

    const solves = await nami.get(`/api/challenges/${gold}/solves`);
    expect(solves.status).toBe(200);
    expect(solves.body.total).toBe(2);
    expect(solves.body.solves.map((s: { username: string; firstBlood: boolean }) => [s.username, s.firstBlood])).toEqual([
      ['Zoro', true],
      ['Nami', false],
    ]);

    const history = await (await client()).get('/api/scoreboard/history');
    expect(history.status).toBe(200);
    expect(history.body.series.map((s: { username: string }) => s.username)).toEqual(['Zoro', 'Nami']);
    // One score change each so far; the last point is the current score.
    const board = (await (await client()).get('/api/scoreboard')).body.entries;
    for (const series of history.body.series) {
      expect(series.points).toHaveLength(1);
      expect(series.points.at(-1).score).toBe(board.find((e: { userId: number }) => e.userId === series.userId).score);
    }
  });

  it('hides the solver list before the event starts and from logged-out visitors', async () => {
    expect((await (await client()).get(`/api/challenges/${gold}/solves`)).status).toBe(401);
    await schedule('UPCOMING', null, null);
    const pirate = await registerClient('Peeker');
    expect((await pirate.get(`/api/challenges/${gold}/solves`)).status).toBe(404);
  });
});
