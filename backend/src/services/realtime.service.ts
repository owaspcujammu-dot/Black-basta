import type { Request, Response } from 'express';

/**
 * Server-Sent Events hub. One long-lived HTTP response per browser tab;
 * the server pushes scoreboard, event-state, participant-count,
 * announcement and challenge-release updates. No polling required.
 */
interface Client {
  res: Response;
  userId: number | null;
  /** The logged-in device (session) this stream belongs to. */
  sid: string | null;
  /** Client address, for limiting anonymous streams. */
  ip: string;
}

const MAX_CLIENTS = 2000;
// Per account: a team of up to 4 players, each with a few tabs open.
const MAX_PER_USER = 12;
// Anonymous viewers (landing page, public scoreboard) get a bounded share, so nobody
// can use up the capacity that logged-in players need. Over the limit, the browser
// falls back to refreshing every few seconds instead.
const MAX_ANONYMOUS = 300;
const MAX_ANONYMOUS_PER_IP = 20;
const HEARTBEAT_MS = 25_000;

const clients = new Set<Client>();
let heartbeat: NodeJS.Timeout | null = null;

function write(client: Client, chunk: string) {
  try {
    client.res.write(chunk);
  } catch {
    clients.delete(client);
  }
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function ensureHeartbeat() {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    for (const client of clients) write(client, ': ping\n\n');
  }, HEARTBEAT_MS);
  heartbeat.unref();
}

/** Opens an SSE stream on this response. Returns false when the server is at capacity. */
export function openStream(req: Request, res: Response, userId: number | null, sid: string | null, initial: Array<[string, unknown]>): boolean {
  if (clients.size >= MAX_CLIENTS) return false;
  const ip = req.ip ?? 'unknown';
  if (userId === null) {
    let anonymous = 0;
    let fromIp = 0;
    for (const client of clients) {
      if (client.userId !== null) continue;
      anonymous++;
      if (client.ip === ip) fromIp++;
    }
    if (anonymous >= MAX_ANONYMOUS || fromIp >= MAX_ANONYMOUS_PER_IP) return false;
  } else {
    // Too many tabs for one account: drop the oldest stream instead of refusing the new one.
    const own = [...clients].filter((client) => client.userId === userId);
    for (const stale of own.slice(0, Math.max(0, own.length - MAX_PER_USER + 1))) {
      stale.res.end();
      clients.delete(stale);
    }
  }

  // Exactly "text/event-stream" (no charset): proxies such as Cloudflare Tunnel only
  // stream responses with that exact type and buffer anything else. setHeader is used
  // because Express's res.set() would append "; charset=utf-8" again.
  res.status(200).setHeader('Content-Type', 'text/event-stream');
  res.set({
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Tell nginx not to buffer the stream.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const client: Client = { res, userId, sid, ip };
  clients.add(client);
  ensureHeartbeat();

  write(client, 'retry: 3000\n\n');
  for (const [event, data] of initial) write(client, frame(event, data));

  req.on('close', () => {
    clients.delete(client);
  });
  return true;
}

export interface BroadcastOptions {
  /** Only deliver to logged-in clients (announcements, challenge releases). */
  authenticatedOnly?: boolean;
  /** Only deliver to this account's devices (e.g. a crew's own solve while the scoreboard is frozen). */
  userId?: number;
}

// Change counters for clients that cannot keep a stream open (e.g. behind a
// Cloudflare quick tunnel) and poll /api/event instead: a changed number tells
// them to refetch challenges or announcements.
const versions = { challenges: 0, announcements: 0 };

export function liveVersions() {
  return { ...versions };
}

export function broadcast(event: string, data: unknown, options: BroadcastOptions = {}) {
  if (event === 'challenge') versions.challenges++;
  if (event.startsWith('announcement')) versions.announcements++;
  if (clients.size === 0) return;
  const payload = frame(event, data);
  for (const client of clients) {
    if (options.authenticatedOnly && client.userId === null) continue;
    if (options.userId !== undefined && client.userId !== options.userId) continue;
    write(client, payload);
  }
}

/** Distinct logged-in users with an open stream right now. */
export function onlineUserCount(): number {
  const ids = new Set<number>();
  for (const client of clients) if (client.userId !== null) ids.add(client.userId);
  return ids.size;
}

export function connectionCount(): number {
  return clients.size;
}

/** Ends the streams of one logged-in device (logout, or signed out to make room). */
export function disconnectSession(sid: string) {
  for (const client of clients) {
    if (client.sid === sid) {
      client.res.end();
      clients.delete(client);
    }
  }
}

/** Ends every stream belonging to a user (e.g. when the account is disabled). */
export function disconnectUser(userId: number) {
  for (const client of clients) {
    if (client.userId === userId) {
      client.res.end();
      clients.delete(client);
    }
  }
}

export function closeAllStreams() {
  for (const client of clients) client.res.end();
  clients.clear();
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
}
