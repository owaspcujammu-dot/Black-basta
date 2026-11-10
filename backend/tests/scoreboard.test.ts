import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Plain point values in this file: no first-blood bonus.
vi.hoisted(() => {
  process.env.FIRST_BLOOD_BONUS = '0';
});

import { type Client, adminClient, createChallenge, prisma, registerClient, setup, startEvent, teardown } from './helpers';
import { invalidateScoreboard, pirateTitle } from '../src/services/scoreboard.service';

let app: Express;
let c100: number, c200: number, c300: number;
let alice: Client, bob: Client, carol: Client, dave: Client;

interface Entry {
  rank: number;
  username: string;
  score: number;
  solved: number;
  lastCapture: string | null;
  title: string;
}

const board = async (c: Client): Promise<Entry[]> => (await c.get('/api/scoreboard')).body.entries;
const solve = async (c: Client, id: number, flag: string) => {
  const res = await c.post(`/api/challenges/${id}/submit`, { flag });
  expect(res.body.correct).toBe(true);
  // Distinct timestamps for the tie-breaker.
  await new Promise((resolve) => setTimeout(resolve, 15));
};

beforeAll(async () => {
  app = await setup();
  c100 = (await createChallenge({ title: 'One', flag: 'NIKA{one}', points: 100 })).id;
  c200 = (await createChallenge({ title: 'Two', flag: 'NIKA{two}', points: 200, category: 'Cryptography' })).id;
  c300 = (await createChallenge({ title: 'Three', flag: 'NIKA{three}', points: 300, category: 'Forensics' })).id;
  alice = await registerClient('Alice');
  bob = await registerClient('Bob');
  carol = await registerClient('Carol');
  dave = await registerClient('Dave');
  await startEvent();
});
afterAll(teardown);

describe('score calculation', () => {
  it('starts everyone at zero, ranked by registration order', async () => {
    const entries = await board(alice);
    expect(entries.map((e) => e.username)).toEqual(['Alice', 'Bob', 'Carol', 'Dave']);
    expect(entries.every((e) => e.score === 0 && e.solved === 0 && e.lastCapture === null)).toBe(true);
  });

  it('adds each challenge value exactly once', async () => {
    await solve(alice, c100, 'NIKA{one}');
    await solve(alice, c200, 'NIKA{two}');
    await alice.post(`/api/challenges/${c100}/submit`, { flag: 'NIKA{one}' }); // duplicate

    const entry = (await board(alice)).find((e) => e.username === 'Alice')!;
    expect(entry).toMatchObject({ rank: 1, score: 300, solved: 2, title: 'Pirate King' });
    expect(entry.lastCapture).not.toBeNull();
  });

  it('wrong submissions do not change the score', async () => {
    await dave.post(`/api/challenges/${c100}/submit`, { flag: 'NIKA{nope}' });
    expect((await board(dave)).find((e) => e.username === 'Dave')!.score).toBe(0);
  });

  it('records the timestamp at which each score was reached', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { usernameKey: 'alice' } });
    const events = await prisma.scoreEvent.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } });
    expect(events.map((e) => e.scoreAfter)).toEqual([100, 300]);
    expect(events[0].createdAt.getTime()).toBeLessThan(events[1].createdAt.getTime());
    expect(user.scoreReachedAt?.getTime()).toBe(events[1].createdAt.getTime());
  });
});

describe('ranking and tie-breaking', () => {
  it('higher score ranks higher', async () => {
    await solve(bob, c200, 'NIKA{two}'); // Bob 200 < Alice 300
    const entries = await board(alice);
    expect(entries.slice(0, 2).map((e) => [e.username, e.score])).toEqual([
      ['Alice', 300],
      ['Bob', 200],
    ]);
  });

  it('on a tie, whoever reached the score first ranks higher', async () => {
    await solve(carol, c300, 'NIKA{three}'); // Carol reaches 300 after Alice did
    const entries = await board(alice);
    expect(entries.slice(0, 3).map((e) => [e.rank, e.username, e.score])).toEqual([
      [1, 'Alice', 300],
      [2, 'Carol', 300],
      [3, 'Bob', 200],
    ]);
  });

  it('the tie-breaker is the time the score was reached, not the order of joining', async () => {
    // Bob catches up to 300 last: he must rank below both earlier 300s.
    await solve(bob, c100, 'NIKA{one}');
    expect((await board(alice)).slice(0, 3).map((e) => e.username)).toEqual(['Alice', 'Carol', 'Bob']);

    // Rewrite history so Bob reached 300 first.
    await prisma.user.update({ where: { usernameKey: 'bob' }, data: { scoreReachedAt: new Date('2020-01-01T00:00:00Z') } });
    invalidateScoreboard();
    expect((await board(alice)).slice(0, 3).map((e) => e.username)).toEqual(['Bob', 'Alice', 'Carol']);
  });

  it('overtaking on score beats any tie-breaker', async () => {
    await solve(carol, c100, 'NIKA{one}'); // Carol 400
    const entries = await board(alice);
    expect(entries[0]).toMatchObject({ rank: 1, username: 'Carol', score: 400 });
  });

  it('pirates with no points rank last and hold no title above Deckhand', async () => {
    const last = (await board(alice)).at(-1)!;
    expect(last).toMatchObject({ username: 'Dave', score: 0, title: 'Deckhand' });
    expect(pirateTitle(1, 0)).toBe('Deckhand');
    expect(pirateTitle(1, 100)).toBe('Pirate King');
    expect(pirateTitle(3, 100)).toBe('Emperor of the Sea');
  });

  it('reports the rank on /me and /profile', async () => {
    expect((await carol.get('/api/auth/me')).body.user).toMatchObject({ rank: 1, score: 400, solved: 2 });
    const profile = (await carol.get('/api/profile')).body.profile;
    expect(profile).toMatchObject({ rank: 1, score: 400, solved: 2, accuracy: 100, firstBloods: 1, totalChallenges: 3 });
  });

  it('excludes disabled accounts and admins', async () => {
    await prisma.user.update({ where: { usernameKey: 'dave' }, data: { disabled: true } });
    invalidateScoreboard();
    const names = (await board(alice)).map((e) => e.username);
    expect(names).not.toContain('Dave');
    expect(names).not.toContain('admin');
  });
});

describe('admin changes re-score the board', () => {
  it('changing a challenge value updates everyone who solved it', async () => {
    const admin = await adminClient();
    const category = await prisma.category.findFirstOrThrow({ where: { name: 'Web' } });
    const res = await admin.put(`/api/admin/challenges/${c100}`, {
      title: 'One',
      description: 'Test challenge',
      categoryId: category.id,
      difficulty: 'EASY',
      points: 150,
      enabled: true,
      hints: [],
    });
    expect(res.status).toBe(200);

    const scores = Object.fromEntries((await board(alice)).map((e) => [e.username, e.score]));
    expect(scores).toMatchObject({ Carol: 450, Alice: 350, Bob: 350 });
  });

  it('deleting a challenge removes its points', async () => {
    const admin = await adminClient();
    expect((await admin.delete(`/api/admin/challenges/${c300}`)).status).toBe(200);

    const entries = await board(alice);
    const scores = Object.fromEntries(entries.map((e) => [e.username, e.score]));
    expect(scores).toMatchObject({ Carol: 150, Alice: 350, Bob: 350 });
    expect(entries.find((e) => e.username === 'Carol')!.solved).toBe(1);
  });
});

describe('live updates (Server-Sent Events)', () => {
  it('pushes the event state and a fresh scoreboard without polling', async () => {
    const server = app.listen(0);
    const { port } = server.address() as AddressInfo;
    const controller = new AbortController();

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/stream`, { signal: controller.signal });
      expect(response.headers.get('content-type')).toContain('text/event-stream');

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const readUntil = async (predicate: (text: string) => boolean) => {
        const deadline = Date.now() + 5000;
        while (!predicate(buffer)) {
          if (Date.now() > deadline) throw new Error(`stream timed out; received: ${buffer.slice(-300)}`);
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
        }
      };

      // Snapshot on connect.
      await readUntil((text) => text.includes('event: event') && text.includes('event: scoreboard'));
      expect(buffer).toContain('"state":"LIVE"');

      // A solve triggers a pushed scoreboard.
      buffer = '';
      const eve = await registerClient('Eve');
      await solve(eve, c200, 'NIKA{two}');
      await readUntil((text) => text.includes('event: scoreboard') && text.includes('"username":"Eve","teamName":null,"players":[],"score":200'));
      expect(buffer).toContain('event: participants');
      // Anonymous streams never receive participant-only events.
      expect(buffer).not.toContain('event: solve');
    } finally {
      controller.abort();
      server.close();
    }
  });
});
