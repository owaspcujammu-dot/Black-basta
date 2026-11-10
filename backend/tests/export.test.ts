import request from 'supertest';
import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Client, adminClient, createChallenge, registerClient, registration, client, setup, startEvent, teardown } from './helpers';
import { csvCell } from '../src/utils/csv';

const FLAG = 'NIKA{csv_export_secret}';
let app: Express;
let admin: Client;

beforeAll(async () => {
  app = await setup();
  const challenge = await createChallenge({ title: 'Export Me', flag: FLAG, points: 150 });
  await startEvent();

  // A player whose name and wrong flag try to smuggle spreadsheet formulas.
  const sly = await client();
  await sly.post('/api/auth/register', registration('Sly', { fullName: '=HYPERLINK("http://evil.example","click")', teamName: '+cmd|calc' }));
  await sly.post(`/api/challenges/${challenge.id}/submit`, { flag: '=1+1' });

  const ace = await registerClient('Ace');
  await ace.post(`/api/challenges/${challenge.id}/submit`, { flag: 'NIKA{nope}' });
  await ace.post(`/api/challenges/${challenge.id}/submit`, { flag: FLAG });

  admin = await adminClient();
});
afterAll(teardown);

const rows = (body: string) => body.replace(/^﻿/, '').trim().split('\r\n');

describe('CSV exports', () => {
  it.each(['scoreboard', 'players', 'solves', 'submissions'])('%s downloads as a UTF-8 CSV file', async (kind) => {
    const res = await admin.get(`/api/admin/export/${kind}`).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toMatch(new RegExp(`^attachment; filename="black-basta-${kind}-\\d{4}-\\d{2}-\\d{2}\\.csv"$`));
    expect(res.text.startsWith('﻿')).toBe(true);
  });

  it('scoreboard is ranked and includes the winner (150 + 50 first-blood bonus)', async () => {
    const lines = rows((await admin.get('/api/admin/export/scoreboard')).text);
    expect(lines[0]).toBe('Rank,Username,Full name,Email,Team,Members,Player points,Score,Solved,First bloods,Pirate title,Last capture (UTC)');
    expect(lines[1]).toMatch(/^1,Ace,Pirate Ace,ace@example\.test,,,,200,1,1,Pirate King,/);
  });

  it('solves and submissions record what happened', async () => {
    const solves = rows((await admin.get('/api/admin/export/solves')).text);
    expect(solves).toHaveLength(2);
    expect(solves[1]).toMatch(/,Ace,,ace@example\.test,Export Me,Web,150,50,Yes,200$/);

    const submissions = rows((await admin.get('/api/admin/export/submissions')).text);
    expect(submissions).toHaveLength(4); // header + 3 attempts
    expect(submissions.some((line) => line.includes(',Wrong,NIKA{nope},'))).toBe(true);
  });

  it('never contains a correct flag', async () => {
    for (const kind of ['scoreboard', 'players', 'solves', 'submissions']) {
      expect((await admin.get(`/api/admin/export/${kind}`)).text).not.toContain(FLAG);
    }
  });

  it('defuses spreadsheet formulas in player-controlled text', async () => {
    const players = (await admin.get('/api/admin/export/players')).text;
    expect(players).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
    expect(players).toContain("'+cmd|calc");
    const submissions = (await admin.get('/api/admin/export/submissions')).text;
    expect(submissions).toContain(",'=1+1,");
    expect(csvCell(-5)).toBe('-5'); // real numbers stay numbers
  });

  it('is admin-only', async () => {
    const participant = await client();
    await participant.post('/api/auth/login', { identifier: 'Ace', password: registration('x').password });
    expect((await participant.get('/api/admin/export/players')).status).toBe(403);
    expect((await request(app).get('/api/admin/export/players')).status).toBe(401);
  });

  it('rejects unknown export names', async () => {
    expect((await admin.get('/api/admin/export/passwords')).status).toBe(404);
  });
});
