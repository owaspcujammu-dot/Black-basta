import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../db';
import { endAllSessions, endSession } from '../services/auth.service';
import { applyEventAction, broadcastParticipants, getEvent, publicEvent, updateSchedule } from '../services/event.service';
import { broadcast, connectionCount, disconnectUser, onlineUserCount } from '../services/realtime.service';
import { getScoreboard, invalidateScoreboard, playerBreakdown, recalculateScores, type PlayerScore } from '../services/scoreboard.service';
import { challengeValue } from '../utils/scoring';
import { removeChallengeFiles, removeStoredFile } from '../services/upload.service';
import { HttpError, badRequest, idParam, notFound } from '../utils/errors';
import { hashChallengeFlag } from '../utils/flags';
import { openSecret, sealSecret } from '../utils/secrets';
import {
  announcementSchema,
  createChallengeSchema,
  eventActionSchema,
  eventScheduleSchema,
  pageQuerySchema,
  updateChallengeSchema,
  updateUserSchema,
  createTeamsSchema,
} from '../utils/schemas';
import { toCsv } from '../utils/csv';
import { sanitizeDisplayFilename, slugify } from '../utils/text';

const ACTIVE_WINDOW_MS = 15 * 60_000;

// Admin view of a challenge. Deliberately has no flagHash / flagSalt. The flags
// themselves are only readable one challenge at a time (GET /challenges/:id/flags),
// from their admin-viewable sealed copies.
const ADMIN_CHALLENGE_SELECT = {
  id: true,
  title: true,
  slug: true,
  description: true,
  difficulty: true,
  points: true,
  scoring: true,
  minimumPoints: true,
  decay: true,
  enabled: true,
  createdAt: true,
  // Every solver holds the same (current) value, so one solve shows it.
  solves: { take: 1, select: { points: true } },
  updatedAt: true,
  category: { select: { id: true, name: true } },
  hints: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, content: true, cost: true } },
  attachments: { orderBy: { id: 'asc' }, select: { id: true, originalName: true, size: true } },
  firstBlood: { select: { user: { select: { username: true } } } },
  practice: true,
  flagCaseInsensitive: true,
  flagSecret: true,
  _count: { select: { solves: true, submissions: true, extraFlags: true, practiceSolves: true } },
} satisfies Prisma.ChallengeSelect;

type AdminChallengeRow = Prisma.ChallengeGetPayload<{ select: typeof ADMIN_CHALLENGE_SELECT }>;

function toAdminChallenge(challenge: AdminChallengeRow) {
  return {
    id: challenge.id,
    title: challenge.title,
    slug: challenge.slug,
    description: challenge.description,
    category: challenge.category,
    difficulty: challenge.difficulty,
    points: challenge.points,
    scoring: challenge.scoring,
    minimumPoints: challenge.minimumPoints,
    decay: challenge.decay,
    /** What solvers hold now (dynamic challenges drop as more crews solve). */
    currentValue: challenge.solves[0]?.points ?? challengeValue(challenge, 0),
    enabled: challenge.enabled,
    createdAt: challenge.createdAt.toISOString(),
    updatedAt: challenge.updatedAt.toISOString(),
    hints: challenge.hints,
    attachments: challenge.attachments.map((file) => ({ id: file.id, name: file.originalName, size: file.size })),
    practice: challenge.practice,
    flagCaseInsensitive: challenge.flagCaseInsensitive,
    /** Further accepted flags (only their number: the flags themselves are never readable). */
    extraFlagCount: challenge._count.extraFlags,
    /** Whether the admin panel can show the flag (false for flags saved before flags were viewable). */
    flagViewable: challenge.flagSecret !== null,
    // Practice challenges count practice solves (they have no scored solves).
    solves: challenge.practice ? challenge._count.practiceSolves : challenge._count.solves,
    submissions: challenge._count.submissions,
    firstBlood: challenge.firstBlood?.user.username ?? null,
  };
}

/** A flag's hash (what answers are checked against) plus its admin-viewable sealed copy. */
function storedFlag(flag: string, caseInsensitive: boolean) {
  return { ...hashChallengeFlag(flag, caseInsensitive), secret: sealSecret(flag.trim()) };
}

function mainFlagFields(flag: string, caseInsensitive: boolean) {
  const { secret, ...hash } = storedFlag(flag, caseInsensitive);
  return { ...hash, flagSecret: secret };
}

/** Scoring columns: the minimum and decay are only kept for dynamic challenges. */
function scoringFields(data: { scoring: 'STATIC' | 'DYNAMIC'; minimumPoints?: number | null; decay?: number | null }) {
  const dynamic = data.scoring === 'DYNAMIC';
  return { scoring: data.scoring, minimumPoints: dynamic ? (data.minimumPoints ?? null) : null, decay: dynamic ? (data.decay ?? null) : null };
}

async function uniqueSlug(title: string, ignoreId?: number): Promise<string> {
  const base = slugify(title);
  for (let attempt = 0; attempt < 50; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const clash = await prisma.challenge.findUnique({ where: { slug }, select: { id: true } });
    if (!clash || clash.id === ignoreId) return slug;
  }
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

async function announceRelease(challenge: { id: number; title: string; practice: boolean; category: { name: string } }) {
  // Practice challenges appear quietly on the practice page.
  if (challenge.practice) {
    broadcast('challenge', { type: 'updated', id: challenge.id }, { authenticatedOnly: true });
    return;
  }
  if ((await getEvent()).state === 'UPCOMING') return;
  broadcast('challenge', { type: 'released', id: challenge.id, title: challenge.title, category: challenge.category.name }, { authenticatedOnly: true });
}

/** GET /api/admin/dashboard */
export async function dashboard(_req: Request, res: Response) {
  const since = new Date(Date.now() - ACTIVE_WINDOW_MS);
  const [registered, active, disabled, challenges, enabledChallenges, submissions, correctSubmissions, recent, event] = await Promise.all([
    prisma.user.count({ where: { role: 'participant' } }),
    prisma.user.count({ where: { role: 'participant', lastActivity: { gte: since } } }),
    prisma.user.count({ where: { role: 'participant', disabled: true } }),
    // Competition challenges only (practice ones are listed on the practice page).
    prisma.challenge.count({ where: { practice: false } }),
    prisma.challenge.count({ where: { enabled: true, practice: false } }),
    prisma.submission.count(),
    prisma.submission.count({ where: { correct: true } }),
    prisma.submission.findMany({
      orderBy: { submittedAt: 'desc' },
      take: 12,
      select: { id: true, correct: true, submittedAt: true, playerName: true, user: { select: { username: true } }, challenge: { select: { title: true } } },
    }),
    publicEvent(),
  ]);

  res.json({
    stats: {
      registered,
      maxParticipants: config.maxParticipants,
      active,
      online: onlineUserCount(),
      connections: connectionCount(),
      disabled,
      challenges,
      enabledChallenges,
      submissions,
      correctSubmissions,
    },
    event,
    recentSubmissions: recent.map((row) => ({
      id: row.id,
      username: row.user.username,
      player: row.playerName,
      challenge: row.challenge.title,
      correct: row.correct,
      submittedAt: row.submittedAt.toISOString(),
    })),
  });
}

// --- challenges ----------------------------------------------------------------

/** GET /api/admin/challenges */
export async function listChallenges(_req: Request, res: Response) {
  const challenges = await prisma.challenge.findMany({
    orderBy: [{ category: { sortOrder: 'asc' } }, { points: 'asc' }, { id: 'asc' }],
    select: ADMIN_CHALLENGE_SELECT,
  });
  res.json({ challenges: challenges.map(toAdminChallenge) });
}

/** POST /api/admin/challenges */
export async function createChallenge(req: Request, res: Response) {
  const data = createChallengeSchema.parse(req.body);
  if (!(await prisma.category.findUnique({ where: { id: data.categoryId }, select: { id: true } }))) {
    throw badRequest('Unknown category.');
  }

  const challenge = await prisma.challenge.create({
    data: {
      title: data.title,
      slug: await uniqueSlug(data.title),
      description: data.description,
      categoryId: data.categoryId,
      difficulty: data.difficulty,
      points: data.points,
      ...scoringFields(data),
      enabled: data.enabled,
      practice: data.practice,
      flagCaseInsensitive: data.flagCaseInsensitive,
      ...mainFlagFields(data.flag, data.flagCaseInsensitive),
      extraFlags: { create: (data.extraFlags ?? []).map((extra) => storedFlag(extra, data.flagCaseInsensitive)) },
      hints: { create: data.hints.map((hint, index) => ({ content: hint.content, cost: hint.cost, sortOrder: index })) },
    },
    select: ADMIN_CHALLENGE_SELECT,
  });

  if (challenge.enabled) await announceRelease(challenge);
  res.status(201).json({ challenge: toAdminChallenge(challenge) });
}

/** PUT /api/admin/challenges/:id */
export async function updateChallenge(req: Request, res: Response) {
  const id = idParam(req.params.id);
  const data = updateChallengeSchema.parse(req.body);

  const existing = await prisma.challenge.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      points: true,
      scoring: true,
      minimumPoints: true,
      decay: true,
      enabled: true,
      practice: true,
      flagCaseInsensitive: true,
      hints: { select: { id: true } },
      _count: { select: { solves: true, extraFlags: true } },
    },
  });
  if (!existing) throw notFound('That challenge does not exist.');
  // Stored hashes depend on the capitals rule, so changing it means re-entering every flag.
  if (data.flagCaseInsensitive !== existing.flagCaseInsensitive) {
    if (!data.flag) throw badRequest('Re-enter the flag when changing whether capitals matter.');
    if (data.extraFlags === undefined && existing._count.extraFlags > 0) {
      throw badRequest('Re-enter the extra accepted flags when changing whether capitals matter.');
    }
  }
  // Scored solves cannot silently become practice (their points would stay on the scoreboard).
  if (data.practice && !existing.practice && existing._count.solves > 0) {
    throw new HttpError(409, 'HAS_SOLVES', 'Crews have already scored on this challenge, so it cannot become a practice challenge.');
  }
  if (!(await prisma.category.findUnique({ where: { id: data.categoryId }, select: { id: true } }))) {
    throw badRequest('Unknown category.');
  }

  const existingHintIds = new Set(existing.hints.map((hint) => hint.id));
  const keptHintIds = new Set(data.hints.filter((hint) => hint.id !== undefined).map((hint) => hint.id as number));
  for (const hintId of keptHintIds) {
    if (!existingHintIds.has(hintId)) throw badRequest('A hint does not belong to this challenge.');
  }
  const removedHintIds = [...existingHintIds].filter((hintId) => !keptHintIds.has(hintId));
  const scoring = scoringFields(data);
  const pointsChanged =
    data.points !== existing.points || scoring.scoring !== existing.scoring || scoring.minimumPoints !== existing.minimumPoints || scoring.decay !== existing.decay;
  const flagUpdate = data.flag ? mainFlagFields(data.flag, data.flagCaseInsensitive) : {};
  // Resolved before the transaction opens: it reads through the shared client.
  const slug = data.title === existing.title ? undefined : await uniqueSlug(data.title, id);

  const challenge = await prisma.$transaction(async (tx) => {
    // Hints are updated in place so participants keep the hints they already paid for.
    if (removedHintIds.length > 0) await tx.hint.deleteMany({ where: { id: { in: removedHintIds } } });
    for (const [index, hint] of data.hints.entries()) {
      if (hint.id !== undefined) {
        await tx.hint.update({ where: { id: hint.id }, data: { content: hint.content, cost: hint.cost, sortOrder: index } });
      } else {
        await tx.hint.create({ data: { challengeId: id, content: hint.content, cost: hint.cost, sortOrder: index } });
      }
    }
    // Extra flags: given = replace the list; omitted = keep it.
    if (data.extraFlags !== undefined) {
      await tx.challengeFlag.deleteMany({ where: { challengeId: id } });
      if (data.extraFlags.length > 0) {
        await tx.challengeFlag.createMany({ data: data.extraFlags.map((extra) => ({ challengeId: id, ...storedFlag(extra, data.flagCaseInsensitive) })) });
      }
    }
    // Static: every solve is worth the new value. Dynamic values are re-applied by recalculateScores below.
    if (pointsChanged && scoring.scoring === 'STATIC') await tx.solve.updateMany({ where: { challengeId: id }, data: { points: data.points } });

    return tx.challenge.update({
      where: { id },
      data: {
        title: data.title,
        slug,
        description: data.description,
        categoryId: data.categoryId,
        difficulty: data.difficulty,
        points: data.points,
        ...scoring,
        enabled: data.enabled,
        practice: data.practice,
        flagCaseInsensitive: data.flagCaseInsensitive,
        ...flagUpdate,
      },
      select: ADMIN_CHALLENGE_SELECT,
    });
  });

  // Removed paid hints are refunded and changed point values re-applied.
  if (pointsChanged || removedHintIds.length > 0) await recalculateScores();
  if (challenge.enabled && !existing.enabled) await announceRelease(challenge);
  else broadcast('challenge', { type: 'updated', id }, { authenticatedOnly: true });

  res.json({ challenge: toAdminChallenge(challenge) });
}

/**
 * GET /api/admin/challenges/:id/flags — the accepted flags, from their sealed copies.
 * A flag saved before flags were viewable comes back as null (re-enter it once).
 */
export async function getChallengeFlags(req: Request, res: Response) {
  const id = idParam(req.params.id);
  const challenge = await prisma.challenge.findUnique({
    where: { id },
    select: { id: true, title: true, flagCaseInsensitive: true, flagSecret: true, extraFlags: { orderBy: { id: 'asc' }, select: { secret: true } } },
  });
  if (!challenge) throw notFound('That challenge does not exist.');
  res.set('Cache-Control', 'no-store');
  res.json({
    id: challenge.id,
    title: challenge.title,
    flagCaseInsensitive: challenge.flagCaseInsensitive,
    flag: openSecret(challenge.flagSecret),
    extraFlags: challenge.extraFlags.map((extra) => openSecret(extra.secret)),
  });
}

/** DELETE /api/admin/challenges/:id */
export async function deleteChallenge(req: Request, res: Response) {
  const id = idParam(req.params.id);
  const existing = await prisma.challenge.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw notFound('That challenge does not exist.');

  await prisma.challenge.delete({ where: { id } });
  removeChallengeFiles(id);
  // Solves, first blood and hint purchases cascade away; rebuild scores from what remains.
  await recalculateScores();
  broadcast('challenge', { type: 'removed', id }, { authenticatedOnly: true });
  res.json({ ok: true });
}

/** POST /api/admin/challenges/:id/attachments (multipart field: files) */
export async function uploadAttachments(req: Request, res: Response) {
  const id = idParam(req.params.id);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const challenge = await prisma.challenge.findUnique({ where: { id }, select: { id: true } });

  if (!challenge || files.length === 0) {
    for (const file of files) removeStoredFile(id, file.filename);
    if (!challenge) {
      removeChallengeFiles(id);
      throw notFound('That challenge does not exist.');
    }
    throw badRequest('No file was uploaded.');
  }

  await prisma.attachment.createMany({
    data: files.map((file) => ({
      challengeId: id,
      originalName: sanitizeDisplayFilename(file.originalname),
      storedName: file.filename,
      size: file.size,
    })),
  });
  const attachments = await prisma.attachment.findMany({ where: { challengeId: id }, orderBy: { id: 'asc' }, select: { id: true, originalName: true, size: true } });
  res.status(201).json({ attachments: attachments.map((file) => ({ id: file.id, name: file.originalName, size: file.size })) });
}

/** DELETE /api/admin/attachments/:id */
export async function deleteAttachment(req: Request, res: Response) {
  const id = idParam(req.params.id);
  const attachment = await prisma.attachment.findUnique({ where: { id } });
  if (!attachment) throw notFound('That file does not exist.');
  await prisma.attachment.delete({ where: { id } });
  removeStoredFile(attachment.challengeId, attachment.storedName);
  res.json({ ok: true });
}

// --- users -----------------------------------------------------------------------

/** GET /api/admin/users?page=&pageSize=&search= */
export async function listUsers(req: Request, res: Response) {
  const { page, pageSize, search } = pageQuerySchema.parse(req.query);
  const where: Prisma.UserWhereInput = search
    ? {
        OR: [
          { usernameKey: { contains: search.toLowerCase() } },
          { email: { contains: search.toLowerCase() } },
          { fullName: { contains: search, mode: 'insensitive' } },
          { teamName: { contains: search, mode: 'insensitive' } },
        ],
      }
    : {};

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ role: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      // Never passwordHash. Organizer-set passwords are readable one team at a time
      // (GET /users/:id/password); here only whether one is stored.
      select: {
        passwordSecret: true,
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
        createdAt: true,
        lastActivity: true,
        _count: { select: { sessions: { where: { expiresAt: { gt: new Date() } } } } },
      },
    }),
  ]);

  const players = await playerBreakdown(users.filter((user) => user.role === 'participant'));

  res.json({
    page,
    pageSize,
    total,
    maxTeamSize: config.maxTeamSize,
    users: users.map(({ _count, passwordSecret, ...user }) => ({
      ...user,
      passwordViewable: passwordSecret !== null,
      players: players.get(user.id) ?? [],
      devices: _count.sessions,
      solved: user.solvedCount,
      solvedCount: undefined,
      createdAt: user.createdAt.toISOString(),
      lastActivity: user.lastActivity?.toISOString() ?? null,
    })),
  });
}

/** PUT /api/admin/users/:id — disable / enable / reset password. */
export async function updateUser(req: Request, res: Response) {
  const id = idParam(req.params.id);
  const data = updateUserSchema.parse(req.body);

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, username: true } });
  if (!target) throw notFound('That pirate does not exist.');
  if (target.role === 'admin') {
    throw new HttpError(403, 'FORBIDDEN', 'Admin accounts are managed through ADMIN_PASSWORD, not the panel.');
  }

  const update: Prisma.UserUpdateInput = {};
  let temporaryPassword: string | undefined;

  if (data.disabled !== undefined) update.disabled = data.disabled;
  if (data.members !== undefined) update.members = data.members;
  if (data.resetPassword) {
    if (data.password) {
      // The organizer's chosen password (viewable later from the admin panel).
      update.passwordHash = await bcrypt.hash(data.password, config.bcryptRounds);
      update.passwordSecret = sealSecret(data.password);
    } else {
      // A fresh random password, shown now and viewable later from the admin panel.
      temporaryPassword = `Kop-${crypto.randomBytes(9).toString('base64url')}7a`;
      update.passwordHash = await bcrypt.hash(temporaryPassword, config.bcryptRounds);
      update.passwordSecret = sealSecret(temporaryPassword);
    }
  }
  // Disabling, resetting or "sign out everywhere" ends every session (device) of that account.
  const signOut = data.disabled === true || Boolean(data.resetPassword) || Boolean(data.signOutEverywhere);
  if (signOut) update.tokenVersion = { increment: 1 };

  const user = await prisma.user.update({ where: { id }, data: update, select: { id: true, username: true, disabled: true, members: true } });
  if (signOut) {
    await endAllSessions(id);
    disconnectUser(id);
  } else if (data.members !== undefined) {
    // A player taken off the team is logged out on their devices (teammates stay logged in).
    const listed = new Set(data.members.map((name) => name.toLowerCase()));
    const sessions = await prisma.session.findMany({ where: { userId: id, playerName: { not: null } }, select: { id: true, playerName: true } });
    for (const session of sessions) {
      if (!listed.has(session.playerName!.toLowerCase())) await endSession(session.id);
    }
  }
  // Disabled crews do not count towards dynamic values (same crews as the scoreboard).
  if (data.disabled !== undefined) await recalculateScores();
  else if (data.members !== undefined) invalidateScoreboard();

  res.json({ user, temporaryPassword });
}

/**
 * GET /api/admin/users/:id/password — an organizer-set team password.
 * null when none is stored: a self-registered account, or a password set before
 * passwords were viewable (reset it once to store it).
 */
export async function getUserPassword(req: Request, res: Response) {
  const id = idParam(req.params.id);
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, username: true, role: true, passwordSecret: true } });
  if (!user) throw notFound('That pirate does not exist.');
  if (user.role === 'admin') throw new HttpError(403, 'FORBIDDEN', 'Admin passwords are never shown.');
  res.set('Cache-Control', 'no-store');
  res.json({ id: user.id, username: user.username, password: openSecret(user.passwordSecret) });
}

/**
 * POST /api/admin/teams — organizer-created team accounts.
 * Body: { teams: [{ name, password?, email? }] }. All-or-nothing: if any line is
 * invalid or taken, nothing is created and every problem is reported by line.
 * Generated passwords are returned now; every password stays viewable from the admin panel.
 */
export async function createTeams(req: Request, res: Response) {
  const { teams } = createTeamsSchema.parse(req.body);

  const problems: { line: number; name: string; message: string }[] = [];
  const seenNames = new Map<string, number>();
  const seenEmails = new Map<string, number>();
  teams.forEach((team, index) => {
    const key = team.name.toLowerCase();
    if (seenNames.has(key)) problems.push({ line: index + 1, name: team.name, message: `Same team name as line ${seenNames.get(key)}.` });
    else seenNames.set(key, index + 1);
    if (team.email) {
      if (seenEmails.has(team.email)) problems.push({ line: index + 1, name: team.name, message: `Same email as line ${seenEmails.get(team.email)}.` });
      else seenEmails.set(team.email, index + 1);
    }
  });

  const [takenNames, takenEmails] = await Promise.all([
    prisma.user.findMany({ where: { usernameKey: { in: [...seenNames.keys()] } }, select: { usernameKey: true } }),
    prisma.user.findMany({ where: { email: { in: [...seenEmails.keys()] } }, select: { email: true } }),
  ]);
  const takenNameSet = new Set(takenNames.map((row) => row.usernameKey));
  const takenEmailSet = new Set(takenEmails.map((row) => row.email));
  teams.forEach((team, index) => {
    if (takenNameSet.has(team.name.toLowerCase())) problems.push({ line: index + 1, name: team.name, message: 'This team name already exists.' });
    if (team.email && takenEmailSet.has(team.email)) problems.push({ line: index + 1, name: team.name, message: 'This email is already used by another account.' });
  });
  if (problems.length > 0) {
    problems.sort((a, b) => a.line - b.line);
    throw new HttpError(400, 'TEAMS_INVALID', `${problems.length} problem(s) found — no teams were created.`, { problems });
  }

  // Hash before the transaction so the registration lock is held only briefly.
  const prepared = await Promise.all(
    teams.map(async (team) => {
      const generated = team.password ? undefined : crypto.randomBytes(8).toString('base64url');
      const password = team.password ?? (generated as string);
      return { ...team, generated, passwordHash: await bcrypt.hash(password, config.bcryptRounds), passwordSecret: sealSecret(password) };
    }),
  );

  const created = await prisma.$transaction(async (tx) => {
    // Same lock as self-registration: the participant cap can never be exceeded.
    await tx.$queryRaw`SELECT id FROM "Event" WHERE id = 1 FOR UPDATE`;
    const count = await tx.user.count({ where: { role: 'participant' } });
    if (count + prepared.length > config.maxParticipants) {
      throw new HttpError(
        403,
        'REGISTRATION_FULL',
        `Only ${Math.max(0, config.maxParticipants - count)} of ${config.maxParticipants} places are left; you tried to add ${prepared.length} team(s).`,
      );
    }
    const highest = await tx.user.aggregate({ _max: { participantNumber: true } });
    let next = Math.max(count, highest._max.participantNumber ?? 0);
    const rows = [];
    for (const team of prepared) {
      const user = await tx.user.create({
        data: {
          username: team.name,
          usernameKey: team.name.toLowerCase(),
          fullName: team.name,
          teamName: team.name,
          members: team.members,
          // Accounts need a unique email; teams without one get a private placeholder.
          email: team.email ?? `team-${crypto.randomBytes(6).toString('hex')}@teams.blackbasta.local`,
          passwordHash: team.passwordHash,
          passwordSecret: team.passwordSecret,
          role: 'participant',
          participantNumber: ++next,
        },
        select: { id: true, username: true, participantNumber: true },
      });
      rows.push({ ...user, password: team.generated });
    }
    return rows;
  });

  await broadcastParticipants();
  invalidateScoreboard();
  res.status(201).json({ created });
}

/**
 * DELETE /api/admin/users/:id — permanently removes a team (participant) account.
 * Its sessions, solves, submissions, first bloods, hint purchases, score history
 * and achievements go with it (database cascades). Admin accounts cannot be deleted.
 */
export async function deleteUser(req: Request, res: Response) {
  const id = idParam(req.params.id);
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, username: true } });
  if (!target) throw notFound('That team does not exist.');
  if (target.role === 'admin') throw new HttpError(403, 'FORBIDDEN', 'Admin accounts cannot be deleted from the panel.');

  disconnectUser(id);
  await prisma.user.delete({ where: { id } });

  await broadcastParticipants();
  // Fewer solvers can raise dynamic values for everyone else.
  await recalculateScores();
  res.json({ ok: true, deleted: target.username });
}

/** GET /api/admin/users/:id/submissions */
export async function userSubmissions(req: Request, res: Response) {
  const id = idParam(req.params.id);
  const { page, pageSize } = pageQuerySchema.parse(req.query);
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, username: true } });
  if (!user) throw notFound('That pirate does not exist.');

  const [total, submissions] = await Promise.all([
    prisma.submission.count({ where: { userId: id } }),
    prisma.submission.findMany({
      where: { userId: id },
      orderBy: { submittedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, submittedFlag: true, correct: true, submittedAt: true, playerName: true, challenge: { select: { title: true } } },
    }),
  ]);

  res.json({
    user,
    page,
    pageSize,
    total,
    submissions: submissions.map((row) => ({
      id: row.id,
      challenge: row.challenge.title,
      player: row.playerName,
      submittedFlag: row.submittedFlag,
      correct: row.correct,
      submittedAt: row.submittedAt.toISOString(),
    })),
  });
}

// --- event control ------------------------------------------------------------------

/** GET /api/admin/event */
export async function getEventAdmin(_req: Request, res: Response) {
  res.json({ event: await publicEvent() });
}

/** POST /api/admin/event/state { action: start | pause | end | reset } */
export async function eventAction(req: Request, res: Response) {
  const { action } = eventActionSchema.parse(req.body);
  await applyEventAction(action);
  res.json({ event: await publicEvent() });
}

/** PUT /api/admin/event { name?, startsAt?, endsAt? } */
export async function eventSchedule(req: Request, res: Response) {
  const data = eventScheduleSchema.parse(req.body);
  await updateSchedule(data);
  res.json({ event: await publicEvent() });
}

// --- CSV exports ---------------------------------------------------------------------

const EXPORT_KINDS = ['scoreboard', 'players', 'solves', 'submissions'] as const;
type ExportKind = (typeof EXPORT_KINDS)[number];

/** "Luffy: 300; Zoro: 150" */
const formatPlayers = (players: PlayerScore[]) => players.map((player) => `${player.name}: ${player.score}`).join('; ');

async function buildExport(kind: ExportKind): Promise<{ header: string[]; rows: unknown[][] }> {
  switch (kind) {
    case 'scoreboard': {
      const board = await getScoreboard();
      const ids = board.entries.map((entry) => entry.userId);
      const [users, bloods] = await Promise.all([
        prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, email: true, members: true } }),
        prisma.firstBlood.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _count: { _all: true } }),
      ]);
      const userById = new Map(users.map((user) => [user.id, user]));
      const bloodsById = new Map(bloods.map((row) => [row.userId, row._count._all]));
      return {
        header: ['Rank', 'Username', 'Full name', 'Email', 'Team', 'Members', 'Player points', 'Score', 'Solved', 'First bloods', 'Pirate title', 'Last capture (UTC)'],
        rows: board.entries.map((entry) => [
          entry.rank,
          entry.username,
          userById.get(entry.userId)?.fullName,
          userById.get(entry.userId)?.email,
          entry.teamName,
          userById.get(entry.userId)?.members.join('; '),
          formatPlayers(entry.players),
          entry.score,
          entry.solved,
          bloodsById.get(entry.userId) ?? 0,
          entry.title,
          entry.lastCapture,
        ]),
      };
    }
    case 'players': {
      const users = await prisma.user.findMany({
        where: { role: 'participant' },
        orderBy: { participantNumber: 'asc' },
        select: { id: true, participantNumber: true, username: true, fullName: true, email: true, teamName: true, members: true, score: true, solvedCount: true, disabled: true, createdAt: true, lastActivity: true },
      });
      const players = await playerBreakdown(users);
      return {
        header: ['Pirate #', 'Username', 'Full name', 'Email', 'Team', 'Members', 'Player points', 'Score', 'Solved', 'Status', 'Registered (UTC)', 'Last activity (UTC)'],
        rows: users.map((user) => [
          user.participantNumber,
          user.username,
          user.fullName,
          user.email,
          user.teamName,
          user.members.join('; '),
          formatPlayers(players.get(user.id) ?? []),
          user.score,
          user.solvedCount,
          user.disabled ? 'Disabled' : 'Active',
          user.createdAt,
          user.lastActivity,
        ]),
      };
    }
    case 'solves': {
      const solves = await prisma.solve.findMany({
        orderBy: { solvedAt: 'asc' },
        select: {
          solvedAt: true,
          points: true,
          bonus: true,
          playerName: true,
          user: { select: { username: true, email: true } },
          challenge: { select: { title: true, category: { select: { name: true } }, firstBlood: { select: { userId: true } } } },
          userId: true,
        },
      });
      return {
        header: ['Solved at (UTC)', 'Username', 'Player', 'Email', 'Challenge', 'Category', 'Points', 'First blood bonus', 'First blood', 'Total'],
        rows: solves.map((solve) => [
          solve.solvedAt,
          solve.user.username,
          solve.playerName,
          solve.user.email,
          solve.challenge.title,
          solve.challenge.category.name,
          solve.points,
          solve.bonus,
          solve.challenge.firstBlood?.userId === solve.userId ? 'Yes' : 'No',
          solve.points + solve.bonus,
        ]),
      };
    }
    case 'submissions': {
      // Correct flags were never stored (they are logged as "[redacted: correct flag]").
      const submissions = await prisma.submission.findMany({
        orderBy: { submittedAt: 'asc' },
        select: {
          submittedAt: true,
          correct: true,
          submittedFlag: true,
          ip: true,
          playerName: true,
          user: { select: { username: true, email: true } },
          challenge: { select: { title: true, category: { select: { name: true } } } },
        },
      });
      return {
        header: ['Submitted at (UTC)', 'Username', 'Player', 'Email', 'Challenge', 'Category', 'Result', 'Submitted flag', 'IP address'],
        rows: submissions.map((row) => [
          row.submittedAt,
          row.user.username,
          row.playerName,
          row.user.email,
          row.challenge.title,
          row.challenge.category.name,
          row.correct ? 'Correct' : 'Wrong',
          row.submittedFlag,
          row.ip,
        ]),
      };
    }
  }
}

/** GET /api/admin/export/:kind — scoreboard | players | solves | submissions, as a CSV download. */
export async function exportCsv(req: Request, res: Response) {
  const kind = String(req.params.kind ?? '');
  if (!(EXPORT_KINDS as readonly string[]).includes(kind)) throw notFound('Unknown export.');
  const { header, rows } = await buildExport(kind as ExportKind);
  const date = new Date().toISOString().slice(0, 10);
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="black-basta-${kind}-${date}.csv"`,
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(toCsv(header, rows));
}

// --- announcements ------------------------------------------------------------------

/** POST /api/admin/announcements */
export async function createAnnouncement(req: Request, res: Response) {
  const data = announcementSchema.parse(req.body);
  const announcement = await prisma.announcement.create({ data });
  broadcast('announcement', announcement, { authenticatedOnly: true });
  res.status(201).json({ announcement });
}

/** DELETE /api/admin/announcements/:id */
export async function deleteAnnouncement(req: Request, res: Response) {
  const id = idParam(req.params.id);
  await prisma.announcement.delete({ where: { id } });
  broadcast('announcement-removed', { id }, { authenticatedOnly: true });
  res.json({ ok: true });
}
