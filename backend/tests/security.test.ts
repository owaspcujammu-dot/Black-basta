import fs from 'node:fs';
import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Client, PASSWORD, adminClient, client, config, createChallenge, prisma, registerClient, registration, setup, startEvent, teardown } from './helpers';
import { challengeUploadDir } from '../src/services/upload.service';
import { safeStoredExtension, sanitizeDisplayFilename } from '../src/utils/text';

let app: Express;
let admin: Client;
let pirate: Client;
let challengeId: number;

beforeAll(async () => {
  app = await setup();
  challengeId = (await createChallenge({ title: 'Vault', flag: 'NIKA{vault}' })).id;
  admin = await adminClient();
  pirate = await registerClient('Sanji');
  await startEvent();
});
afterAll(teardown);

describe('CSRF', () => {
  it('rejects a state-changing request without the CSRF token', async () => {
    const res = await pirate.agent.post(`/api/challenges/${challengeId}/submit`).send({ flag: 'NIKA{vault}' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_TOKEN');
    expect(await prisma.solve.count()).toBe(0);
  });

  it('rejects a token that does not match the cookie', async () => {
    const res = await pirate.agent.post('/api/auth/logout').set('X-CSRF-Token', 'f'.repeat(64));
    expect(res.status).toBe(403);
  });

  it('rejects requests from a foreign origin even with a valid token', async () => {
    const res = await pirate.agent
      .post(`/api/challenges/${challengeId}/submit`)
      .set('X-CSRF-Token', pirate.csrf)
      .set('Origin', 'https://evil.example')
      .send({ flag: 'NIKA{vault}' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_ORIGIN');
  });

  it('accepts the configured frontend origin', async () => {
    const res = await pirate.agent
      .post(`/api/challenges/${challengeId}/submit`)
      .set('X-CSRF-Token', pirate.csrf)
      .set('Origin', 'http://localhost:5173')
      .send({ flag: 'NIKA{wrong}' });
    expect(res.status).toBe(200);
  });

  it('does not send CORS approval to other origins', async () => {
    const res = await request(app).get('/api/event').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('injection', () => {
  const PAYLOADS = ["' OR '1'='1", "admin'--", "'; DROP TABLE \"User\"; --", '" OR ""="', "admin' UNION SELECT * FROM \"User\" --"];

  it.each(PAYLOADS)('SQL injection in login is treated as plain text: %s', async (payload) => {
    const c = await client();
    const res = await c.post('/api/auth/login', { identifier: payload, password: payload });
    expect(res.status).toBe(401);
    expect(await prisma.user.count()).toBeGreaterThan(0);
  });

  it('SQL injection in the admin user search returns nothing extra', async () => {
    const res = await admin.get(`/api/admin/users?search=${encodeURIComponent("' OR 1=1 --")}`);
    expect(res.status).toBe(200);
    expect(res.body.users).toEqual([]);
  });

  it('SQL injection in a flag is just a wrong flag', async () => {
    const res = await pirate.post(`/api/challenges/${challengeId}/submit`, { flag: "NIKA{' OR '1'='1}" });
    expect(res.body.correct).toBe(false);
  });

  it('rejects non-numeric ids instead of passing them to the database', async () => {
    expect((await pirate.get('/api/challenges/1%20OR%201=1')).status).toBe(404);
    expect((await pirate.get('/api/challenges/-1')).status).toBe(404);
    expect((await pirate.post('/api/challenges/abc/submit', { flag: 'NIKA{x}' })).status).toBe(404);
  });

  it('rejects script tags in usernames', async () => {
    const c = await client();
    const res = await c.post('/api/auth/register', registration('<script>alert(1)</script>'));
    expect(res.status).toBe(400);
  });

  it('returns stored markup as inert JSON, never as HTML', async () => {
    const xss = '<img src=x onerror=alert(1)>';
    const created = await admin.post('/api/admin/announcements', { title: xss, message: xss });
    expect(created.status).toBe(201);

    const res = await pirate.get('/api/announcements');
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.body.announcements[0].title).toBe(xss);
  });

  it('ignores mass-assignment of privileged fields on registration', async () => {
    const c = await client();
    const res = await c.post('/api/auth/register', registration('Greedy', { score: 99999, role: 'admin', participantNumber: 1, disabled: false }));
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ role: 'participant', score: 0 });
  });
});

describe('HTTP hardening', () => {
  it('sends security headers and hides the framework', async () => {
    const res = await request(app).get('/api/event');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('rejects oversized JSON bodies', async () => {
    const res = await pirate.post(`/api/challenges/${challengeId}/submit`, { flag: 'A'.repeat(100_000) });
    expect(res.status).toBe(413);
  });

  it('returns a generic error for malformed JSON', async () => {
    const res = await pirate.agent.post('/api/auth/login').set('X-CSRF-Token', pirate.csrf).set('Content-Type', 'application/json').send('{"broken":');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/SyntaxError|at JSON\.parse|node_modules/);
  });

  it('does not leak internals on unknown routes', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('file uploads and downloads', () => {
  let attachmentId: number;

  it('stores uploads under a random name, never the client filename', async () => {
    const res = await admin.agent
      .post(`/api/admin/challenges/${challengeId}/attachments`)
      .set('X-CSRF-Token', admin.csrf)
      .attach('files', Buffer.from('#!/bin/sh\necho pwned\n'), { filename: '../../../evil.sh', contentType: 'application/x-sh' })
      .attach('files', Buffer.from('PK\u0003\u0004 fake zip'), { filename: 'challenge.zip', contentType: 'application/zip' });
    expect(res.status).toBe(201);
    expect(res.body.attachments).toHaveLength(2);

    const rows = await prisma.attachment.findMany({ where: { challengeId }, orderBy: { id: 'asc' } });
    attachmentId = rows[1].id;
    expect(rows[0].storedName).toMatch(/^[a-f0-9]{16}\.bin$/); // .sh is not kept
    expect(rows[1].storedName).toMatch(/^[a-f0-9]{16}\.zip$/);
    expect(rows[0].originalName).not.toMatch(/[\\/]|\.\./);

    const directory = challengeUploadDir(challengeId);
    expect(path.basename(directory)).toBe(`challenge_${String(challengeId).padStart(3, '0')}`);
    expect(fs.readdirSync(directory).sort()).toEqual(rows.map((row) => row.storedName).sort());
    // Nothing escaped the uploads directory.
    expect(fs.existsSync(path.resolve(config.uploadDir, '..', 'evil.sh'))).toBe(false);
  });

  it('participants cannot upload', async () => {
    const res = await pirate.agent
      .post(`/api/admin/challenges/${challengeId}/attachments`)
      .set('X-CSRF-Token', pirate.csrf)
      .attach('files', Buffer.from('x'), 'x.txt');
    expect(res.status).toBe(403);
  });

  it('serves attachments only to authenticated users, as forced downloads', async () => {
    const url = `/api/challenges/${challengeId}/attachments/${attachmentId}`;
    expect((await request(app).get(url)).status).toBe(401);

    const res = await pirate.get(url).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="challenge\.zip"/);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('blocks path traversal in the download URL', async () => {
    for (const evil of ['..%2F..%2F..%2Fetc%2Fpasswd', '..%5C..%5Cwindows%5Cwin.ini', '%2e%2e%2f.env', '0', '1e3']) {
      const res = await pirate.get(`/api/challenges/${challengeId}/attachments/${evil}`);
      expect(res.status).toBe(404);
    }
  });

  it('does not serve an attachment through the wrong challenge id (IDOR)', async () => {
    const other = await createChallenge({ title: 'Other', flag: 'NIKA{other}' });
    expect((await pirate.get(`/api/challenges/${other.id}/attachments/${attachmentId}`)).status).toBe(404);
  });

  it('hides attachments of disabled challenges', async () => {
    await prisma.challenge.update({ where: { id: challengeId }, data: { enabled: false } });
    expect((await pirate.get(`/api/challenges/${challengeId}/attachments/${attachmentId}`)).status).toBe(404);
    await prisma.challenge.update({ where: { id: challengeId }, data: { enabled: true } });
  });

  it('sanitises hostile filenames', () => {
    expect(sanitizeDisplayFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeDisplayFilename('..\\..\\windows\\system32\\cmd.exe')).toBe('cmd.exe');
    expect(sanitizeDisplayFilename('a\u0000b\r\n.txt')).not.toMatch(/[\u0000\r\n]/);
    expect(sanitizeDisplayFilename('"; rm -rf /; ".zip')).not.toMatch(/["/;]/);
    expect(sanitizeDisplayFilename('....')).toBe('attachment.bin');
    expect(safeStoredExtension('shell.php')).toBe('bin');
    expect(safeStoredExtension('page.html')).toBe('bin');
    expect(safeStoredExtension('archive.ZIP')).toBe('zip');
    expect(safeStoredExtension('noextension')).toBe('bin');
  });
});

describe('access control (IDOR)', () => {
  it('a participant only ever sees their own profile', async () => {
    const other = await registerClient('Chopper');
    await other.post(`/api/challenges/${challengeId}/submit`, { flag: 'NIKA{vault}' });

    const mine = (await pirate.get('/api/profile?userId=999&id=1')).body.profile;
    expect(mine.username).toBe('Sanji');
    expect(mine.solved).toBe(0);
  });

  it('never exposes emails or password hashes on the public scoreboard', async () => {
    const res = await request(app).get('/api/scoreboard');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/@example\.test|passwordHash|\$2[aby]\$/);
  });

  it('accepts the issued session cookie but not a tampered copy', async () => {
    const c = await client();
    const login = await c.post('/api/auth/login', { identifier: 'Sanji', password: PASSWORD });
    const cookies = ([] as string[]).concat(login.headers['set-cookie'] ?? []);
    const session = cookies.find((cookie) => cookie.startsWith('kop_session='))!.split(';')[0];

    expect((await request(app).get('/api/auth/me').set('Cookie', session)).status).toBe(200);
    const tampered = `${session.slice(0, -4)}${session.endsWith('AAAA') ? 'BBBB' : 'AAAA'}`;
    expect((await request(app).get('/api/auth/me').set('Cookie', tampered)).status).toBe(401);
  });
});
