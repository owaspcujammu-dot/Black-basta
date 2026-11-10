import bcrypt from 'bcrypt';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../db';
import {
  CSRF_COOKIE,
  clearSessionCookie,
  getDummyHash,
  issueCsrfToken,
  endSession,
  startSession,
  toPublicUser,
} from '../services/auth.service';
import { broadcastParticipants, participantCount } from '../services/event.service';
import { invalidateScoreboard } from '../services/scoreboard.service';
import { HttpError, conflict } from '../utils/errors';
import { loginSchema, registerSchema } from '../utils/schemas';

const registrationFull = () =>
  new HttpError(
    403,
    'REGISTRATION_FULL',
    `The Grand Line is Full! Registration for ${config.eventName} has reached its maximum capacity of ${config.maxParticipants} pirates.`,
  );

/** GET /api/auth/csrf — issues the double-submit CSRF token. */
export function csrf(req: Request, res: Response) {
  const existing = req.cookies?.[CSRF_COOKIE];
  const csrfToken = typeof existing === 'string' && /^[a-f0-9]{64}$/.test(existing) ? existing : issueCsrfToken(res);
  res.json({ csrfToken });
}

/** POST /api/auth/register */
export async function register(req: Request, res: Response) {
  if (!config.selfRegistration) {
    throw new HttpError(403, 'REGISTRATION_CLOSED', 'Registration is closed. Your team name and password are provided by the organizers.');
  }
  const data = registerSchema.parse(req.body);

  // Cheap early exit before paying for a bcrypt hash; the authoritative check is in the transaction.
  if ((await participantCount()) >= config.maxParticipants) throw registrationFull();

  const passwordHash = await bcrypt.hash(data.password, config.bcryptRounds);
  const usernameKey = data.username.toLowerCase();

  let user;
  try {
    user = await prisma.$transaction(async (tx) => {
      // Row lock on the event singleton serialises registrations, so two
      // simultaneous sign-ups can never both take the last berth.
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = 1 FOR UPDATE`;

      const count = await tx.user.count({ where: { role: 'participant' } });
      if (count >= config.maxParticipants) throw registrationFull();

      if (await tx.user.findUnique({ where: { usernameKey }, select: { id: true } })) {
        throw conflict('USERNAME_TAKEN', 'That pirate name is already taken.');
      }
      if (await tx.user.findUnique({ where: { email: data.email }, select: { id: true } })) {
        throw conflict('EMAIL_TAKEN', 'An account with that email already exists.');
      }

      const highest = await tx.user.aggregate({ _max: { participantNumber: true } });
      return tx.user.create({
        data: {
          username: data.username,
          usernameKey,
          fullName: data.fullName,
          email: data.email,
          teamName: data.teamName ?? null,
          passwordHash,
          role: 'participant',
          // Registration order. max() only matters if rows were ever removed by hand.
          participantNumber: Math.max(count, highest._max.participantNumber ?? 0) + 1,
          lastActivity: new Date(),
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw conflict('ALREADY_REGISTERED', 'That username or email is already registered.');
    }
    throw error;
  }

  await broadcastParticipants();
  invalidateScoreboard();
  await startSession(res, user, req.get('user-agent'));

  res.status(201).json({
    user: await toPublicUser(user),
    participantNumber: user.participantNumber,
    maxParticipants: config.maxParticipants,
  });
}

/**
 * Team mode: which team member is logging in. A listed player matches regardless
 * of capitalisation; an unlisted name is added while the team has a free slot
 * (at most MAX_TEAM_SIZE). Runs under a row lock so two simultaneous logins
 * cannot both take the last slot.
 */
async function resolvePlayer(userId: number, typed: string): Promise<string> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const { members } = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { members: true } });
    const listed = members.find((member) => member.toLowerCase() === typed.toLowerCase());
    if (listed) return listed;
    if (members.length >= config.maxTeamSize) {
      throw new HttpError(403, 'PLAYER_NOT_ON_TEAM', `"${typed}" is not a player on this team. Players: ${members.join(', ')}.`);
    }
    await tx.user.update({ where: { id: userId }, data: { members: [...members, typed] } });
    return typed;
  });
}

/** POST /api/auth/login */
export async function login(req: Request, res: Response) {
  const { identifier, password, player: typedPlayer } = loginSchema.parse(req.body);
  // Team names may contain spaces: compare them the way they are stored (trimmed, single spaces, lower case).
  const key = identifier.trim().replace(/\s+/g, ' ').toLowerCase();
  const teamMode = !config.selfRegistration;

  const user = await prisma.user.findFirst({ where: { OR: [{ usernameKey: key }, { email: key }] } });
  const valid = await bcrypt.compare(password, user?.passwordHash ?? (await getDummyHash()));

  // One message for "no such account" and "wrong password".
  if (!user || !valid) throw new HttpError(401, 'INVALID_CREDENTIALS', teamMode ? 'Invalid team name or password.' : 'Invalid username or password.');
  if (user.disabled) throw new HttpError(403, 'ACCOUNT_DISABLED', 'This account has been disabled by the organizers.');

  // Team logins record which player is on this device (their solves count as theirs).
  let player: string | null = null;
  if (teamMode && user.role === 'participant') {
    if (!typedPlayer) throw new HttpError(400, 'PLAYER_REQUIRED', 'Enter your player name — your own name in this team.');
    player = await resolvePlayer(user.id, typedPlayer);
  }

  // May refuse: a team can be logged in on at most MAX_TEAM_SIZE devices.
  await startSession(res, user, req.get('user-agent'), player);
  const fresh = await prisma.user.update({ where: { id: user.id }, data: { lastActivity: new Date() } });
  res.json({ user: { ...(await toPublicUser(fresh)), player } });
}

/** POST /api/auth/logout */
export async function logout(req: Request, res: Response) {
  // Only this device: teammates on the same team login stay signed in.
  if (req.auth) await endSession(req.auth.sid);
  clearSessionCookie(res);
  res.json({ ok: true });
}

/** GET /api/auth/me */
export async function me(req: Request, res: Response) {
  res.json({ user: { ...(await toPublicUser(req.user!)), player: req.player ?? null } });
}
