import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db';
import { SESSION_COOKIE, verifySession } from '../services/auth.service';
import { HttpError, forbidden, unauthorized } from '../utils/errors';

const ACTIVITY_WRITE_INTERVAL_MS = 60_000;

const USER_SELECT = {
  id: true,
  username: true,
  fullName: true,
  email: true,
  teamName: true,
  members: true,
  role: true,
  participantNumber: true,
  score: true,
  solvedCount: true,
  disabled: true,
  tokenVersion: true,
  lastActivity: true,
} as const;

/** Verifies the session cookie's signature (no database hit). Runs on every API request. */
export function attachAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === 'string' && token) {
    const claims = verifySession(token);
    if (claims) req.auth = claims;
  }
  next();
}

/**
 * Loads the current user through their session (device) record. Rejects
 * logged-out or signed-out devices, revoked tokens and disabled accounts.
 */
async function loadUser(req: Request): Promise<Express.AuthUser | null> {
  if (!req.auth) return null;
  const session = await prisma.session.findUnique({
    where: { id: req.auth.sid },
    select: { userId: true, expiresAt: true, lastSeenAt: true, playerName: true, user: { select: USER_SELECT } },
  });
  const now = Date.now();
  if (!session || session.userId !== req.auth.id || session.expiresAt.getTime() <= now) return null;
  const user = session.user;
  if (user.tokenVersion !== req.auth.tv) return null;
  if (user.disabled) throw new HttpError(403, 'ACCOUNT_DISABLED', 'This account has been disabled by the organizers.');
  req.player = session.playerName;

  // Device activity (used to free the slots of idle team devices), written at most once a minute.
  if (now - session.lastSeenAt.getTime() > ACTIVITY_WRITE_INTERVAL_MS) {
    prisma.session.updateMany({ where: { id: req.auth.sid }, data: { lastSeenAt: new Date(now) } }).catch(() => undefined);
  }
  return user;
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const user = await loadUser(req);
  if (!user) throw unauthorized();
  req.user = user;

  // Track activity without writing on every single request.
  const last = user.lastActivity?.getTime() ?? 0;
  if (Date.now() - last > ACTIVITY_WRITE_INTERVAL_MS) {
    prisma.user
      .update({ where: { id: user.id }, data: { lastActivity: new Date() }, select: { id: true } })
      .catch(() => undefined);
  }
  next();
}

/** Like requireAuth, but anonymous requests continue without a user. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = await loadUser(req);
    if (user) req.user = user;
  } catch {
    // Disabled account: treat as anonymous on public endpoints.
  }
  next();
}

/** Must follow requireAuth. The role is read from the database, never from the token alone. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') throw forbidden();
  next();
}
