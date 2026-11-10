import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import type { CookieOptions, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role, User } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../db';
import { HttpError } from '../utils/errors';
import { disconnectSession } from './realtime.service';
import { getPublicRank } from './event.service';

export const SESSION_COOKIE = 'kop_session';

// Built once: given a plain string, jsonwebtoken first tries (and fails) to parse it
// as a public key on every verify, which costs noticeable CPU on every request.
const jwtKey = crypto.createSecretKey(Buffer.from(config.jwtSecret, 'utf8'));
export const CSRF_COOKIE = 'kop_csrf';

export interface SessionClaims {
  id: number;
  role: Role;
  /** Token version: must equal User.tokenVersion or the session is void. */
  tv: number;
  /** Session (device) id: must exist in the Session table. */
  sid: string;
}

/** A team device idle this long may be signed out to make room for a new login. */
const DEVICE_IDLE_MINUTES = 30;

const baseCookie: CookieOptions = {
  secure: config.cookieSecure,
  sameSite: 'strict',
  path: '/',
};

function signSession(user: Pick<User, 'id' | 'role' | 'tokenVersion'>, sid: string): string {
  return jwt.sign({ role: user.role, tv: user.tokenVersion, sid }, jwtKey, {
    algorithm: 'HS256',
    subject: String(user.id),
    expiresIn: `${config.sessionHours}h`,
  });
}

export function verifySession(token: string): SessionClaims | null {
  try {
    const payload = jwt.verify(token, jwtKey, { algorithms: ['HS256'] });
    if (typeof payload === 'string') return null;
    const id = Number(payload.sub);
    if (!Number.isInteger(id) || typeof payload.tv !== 'number' || typeof payload.sid !== 'string') return null;
    if (payload.role !== 'participant' && payload.role !== 'admin') return null;
    return { id, role: payload.role, tv: payload.tv, sid: payload.sid };
  } catch {
    return null;
  }
}

/**
 * Logs a device in: records a session and sets the cookie.
 * Team (participant) accounts may be logged in on at most MAX_TEAM_SIZE devices;
 * when full, a device idle for DEVICE_IDLE_MINUTES is signed out to make room,
 * otherwise the login is refused. Admins are not limited.
 */
export async function startSession(res: Response, user: Pick<User, 'id' | 'role' | 'tokenVersion'>, userAgent?: string, playerName: string | null = null): Promise<void> {
  const sid = crypto.randomBytes(18).toString('base64url');
  const now = new Date();
  const idleBefore = now.getTime() - DEVICE_IDLE_MINUTES * 60_000;

  const evicted = await prisma.$transaction(async (tx) => {
    // Serialise logins per account so two devices can never both take the last slot.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
    await tx.session.deleteMany({ where: { userId: user.id, expiresAt: { lte: now } } });

    const removed: string[] = [];
    if (user.role === 'participant') {
      const active = await tx.session.findMany({ where: { userId: user.id }, orderBy: { lastSeenAt: 'asc' }, select: { id: true, lastSeenAt: true } });
      while (active.length >= config.maxTeamSize) {
        const stalest = active[0];
        if (stalest.lastSeenAt.getTime() > idleBefore) {
          throw new HttpError(
            403,
            'TEAM_DEVICE_LIMIT',
            `Your team is already logged in on ${config.maxTeamSize} devices (the team limit). Log out on one of them, or ask the organizers to sign your team out everywhere.`,
          );
        }
        await tx.session.delete({ where: { id: stalest.id } });
        removed.push(stalest.id);
        active.shift();
      }
    }
    await tx.session.create({
      data: { id: sid, userId: user.id, playerName, expiresAt: new Date(now.getTime() + config.sessionHours * 3_600_000), userAgent: userAgent?.slice(0, 200) },
    });
    return removed;
  });
  for (const id of evicted) disconnectSession(id);

  // HTTP-only: page JavaScript can never read the session token.
  res.cookie(SESSION_COOKIE, signSession(user, sid), {
    ...baseCookie,
    httpOnly: true,
    maxAge: config.sessionHours * 60 * 60 * 1000,
  });
}

/** Logs one device out. */
export async function endSession(sid: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: sid } });
  disconnectSession(sid);
}

/** Logs an account out on every device. */
export async function endAllSessions(userId: number): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { ...baseCookie, httpOnly: true });
}

/** Double-submit CSRF token: readable cookie that must be echoed in a header. */
export function issueCsrfToken(res: Response): string {
  const token = crypto.randomBytes(32).toString('hex');
  res.cookie(CSRF_COOKIE, token, { ...baseCookie, httpOnly: false, maxAge: 24 * 60 * 60 * 1000 });
  return token;
}

type PublicUserSource = Pick<
  User,
  'id' | 'username' | 'fullName' | 'email' | 'teamName' | 'members' | 'role' | 'participantNumber' | 'score' | 'solvedCount'
>;

/** The only user shape ever sent to a browser. Never includes the password hash. */
export async function toPublicUser(user: PublicUserSource) {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    teamName: user.teamName,
    role: user.role,
    participantNumber: user.participantNumber,
    score: user.score,
    solved: user.solvedCount,
    members: user.members,
    // While the scoreboard is frozen this is the frozen rank: nobody learns live standings.
    rank: user.role === 'participant' ? await getPublicRank(user.id) : null,
  };
}

let dummyHash: Promise<string> | null = null;

/**
 * A throwaway hash at the configured cost. Login compares against it when the
 * account does not exist, so response timing does not reveal which usernames
 * are registered.
 */
export function getDummyHash(): Promise<string> {
  dummyHash ??= bcrypt.hash(crypto.randomBytes(16).toString('hex'), config.bcryptRounds);
  return dummyHash;
}
