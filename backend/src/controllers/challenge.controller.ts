import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { submitFlag, unlockHint } from '../services/challenge.service';
import { currentEvent, isFrozen } from '../services/event.service';
import { challengeUploadDir } from '../services/upload.service';
import { idParam, notFound } from '../utils/errors';
import { submitFlagSchema } from '../utils/schemas';
import { COUNTED_SOLVE, challengeValue } from '../utils/scoring';

/** Before the CTF starts, participants cannot see any challenge. Admins always can. */
async function challengesHidden(req: Request): Promise<boolean> {
  if (req.user!.role === 'admin') return false;
  return (await currentEvent()).state === 'UPCOMING';
}

/**
 * Which solves a viewer may see (counts, first blood, solver lists, dynamic
 * values): all of them for admins or while live; while the scoreboard is frozen,
 * those up to the freeze plus the viewer's own crew's.
 */
async function visibleSolves(req: Request): Promise<{
  where: Prisma.SolveWhereInput;
  visible: (at: Date, userId: number) => boolean;
}> {
  const event = await currentEvent();
  const user = req.user!;
  if (user.role === 'admin' || !isFrozen(event)) return { where: COUNTED_SOLVE, visible: () => true };
  const freezeAt = event.freezeAt!;
  return {
    where: {
      ...COUNTED_SOLVE,
      OR: [{ solvedAt: { lte: freezeAt } }, { userId: user.id }],
    },
    visible: (at, userId) => at <= freezeAt || userId === user.id,
  };
}

const SCORING_SELECT = {
  points: true,
  scoring: true,
  minimumPoints: true,
  decay: true,
} as const;

/** GET /api/categories */
export async function listCategories(_req: Request, res: Response) {
  const categories = await prisma.category.findMany({
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true, slug: true },
  });
  res.json({ categories });
}

/** GET /api/challenges — cards only: no descriptions, no hints, and never a flag. */
export async function listChallenges(req: Request, res: Response) {
  const user = req.user!;
  if (await challengesHidden(req)) {
    res.json({ locked: true, challenges: [] });
    return;
  }

  const shown = await visibleSolves(req);
  const [challenges, solved, counts] = await Promise.all([
    prisma.challenge.findMany({
      where: { practice: false, ...(user.role === 'admin' ? {} : { enabled: true }) },
      orderBy: [{ category: { sortOrder: 'asc' } }, { points: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        title: true,
        slug: true,
        difficulty: true,
        ...SCORING_SELECT,
        enabled: true,
        category: { select: { id: true, name: true, slug: true } },
        firstBlood: {
          select: {
            userId: true,
            createdAt: true,
            user: { select: { username: true } },
          },
        },
      },
    }),
    prisma.solve.findMany({
      where: { userId: user.id },
      select: { challengeId: true, playerName: true },
    }),
    prisma.solve.groupBy({
      by: ['challengeId'],
      where: shown.where,
      _count: { _all: true },
    }),
  ]);
  const solveCount = new Map(counts.map((row) => [row.challengeId, row._count._all]));
  // Challenge id -> the team member who claimed it (null when not recorded).
  const solvedBy = new Map(solved.map((solve) => [solve.challengeId, solve.playerName]));

  res.json({
    locked: false,
    challenges: challenges.map((challenge) => ({
      id: challenge.id,
      title: challenge.title,
      slug: challenge.slug,
      category: challenge.category,
      difficulty: challenge.difficulty,
      practice: false,
      // Dynamic challenges show their current value; the starting and minimum values come with it.
      points: challengeValue(challenge, solveCount.get(challenge.id) ?? 0),
      scoring: challenge.scoring,
      initialPoints: challenge.points,
      minimumPoints: challenge.scoring === 'DYNAMIC' ? challenge.minimumPoints : null,
      enabled: challenge.enabled,
      solves: solveCount.get(challenge.id) ?? 0,
      firstBlood: challenge.firstBlood && shown.visible(challenge.firstBlood.createdAt, challenge.firstBlood.userId) ? challenge.firstBlood.user.username : null,
      solved: solvedBy.has(challenge.id),
      solvedBy: solvedBy.get(challenge.id) ?? null,
    })),
  });
}

/**
 * GET /api/practice — practice challenges: open at any time (also before the CTF
 * starts and after it ends), solved per crew, never scored.
 */
export async function listPractice(req: Request, res: Response) {
  const user = req.user!;
  const [challenges, solved, counts] = await Promise.all([
    prisma.challenge.findMany({
      where: { practice: true, ...(user.role === 'admin' ? {} : { enabled: true }) },
      orderBy: [{ category: { sortOrder: 'asc' } }, { points: 'asc' }, { id: 'asc' }],
      select: { id: true, title: true, slug: true, difficulty: true, enabled: true, category: { select: { id: true, name: true, slug: true } } },
    }),
    prisma.practiceSolve.findMany({ where: { userId: user.id }, select: { challengeId: true, playerName: true } }),
    prisma.practiceSolve.groupBy({ by: ['challengeId'], where: { user: COUNTED_SOLVE.user }, _count: { _all: true } }),
  ]);
  const solveCount = new Map(counts.map((row) => [row.challengeId, row._count._all]));
  const solvedBy = new Map(solved.map((solve) => [solve.challengeId, solve.playerName]));
  res.json({
    locked: false,
    challenges: challenges.map((challenge) => ({
      id: challenge.id,
      title: challenge.title,
      slug: challenge.slug,
      category: challenge.category,
      difficulty: challenge.difficulty,
      practice: true,
      points: 0,
      scoring: 'STATIC',
      initialPoints: 0,
      minimumPoints: null,
      enabled: challenge.enabled,
      solves: solveCount.get(challenge.id) ?? 0,
      firstBlood: null,
      solved: solvedBy.has(challenge.id),
      solvedBy: solvedBy.get(challenge.id) ?? null,
    })),
  });
}

/** GET /api/challenges/:id */
export async function getChallenge(req: Request, res: Response) {
  const user = req.user!;
  const id = idParam(req.params.id);

  const challenge = await prisma.challenge.findFirst({
    where: { id, ...(user.role === 'admin' ? {} : { enabled: true }) },
    // Explicit select: flagHash / flagSalt are never loaded for this endpoint.
    select: {
      id: true,
      title: true,
      slug: true,
      description: true,
      difficulty: true,
      ...SCORING_SELECT,
      enabled: true,
      practice: true,
      category: { select: { id: true, name: true, slug: true } },
      hints: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { id: true, content: true, cost: true },
      },
      attachments: {
        orderBy: { id: 'asc' },
        select: { id: true, originalName: true, size: true },
      },
      firstBlood: {
        select: {
          userId: true,
          createdAt: true,
          bonus: true,
          user: { select: { username: true } },
        },
      },
    },
  });
  // Practice challenges are open at any time; the others are hidden until the CTF starts.
  if (!challenge || (!challenge.practice && (await challengesHidden(req)))) throw notFound('That challenge does not exist.');
  if (challenge.practice) {
    const [solves, practiceSolve] = await Promise.all([
      prisma.practiceSolve.count({ where: { challengeId: id, user: COUNTED_SOLVE.user } }),
      prisma.practiceSolve.findUnique({
        where: { userId_challengeId: { userId: user.id, challengeId: id } },
        select: { solvedAt: true, playerName: true },
      }),
    ]);
    res.json({
      challenge: {
        id: challenge.id,
        title: challenge.title,
        slug: challenge.slug,
        description: challenge.description,
        category: challenge.category,
        difficulty: challenge.difficulty,
        practice: true,
        points: 0,
        scoring: 'STATIC',
        initialPoints: 0,
        minimumPoints: null,
        decay: null,
        enabled: challenge.enabled,
        solves,
        solved: Boolean(practiceSolve),
        solvedAt: practiceSolve?.solvedAt.toISOString() ?? null,
        solvedBy: practiceSolve?.playerName ?? null,
        pointsAwarded: null,
        firstBlood: null,
        // Practice hints are free: always shown.
        hints: challenge.hints.map((hint, index) => ({ id: hint.id, number: index + 1, cost: 0, unlocked: true, content: hint.content })),
        attachments: challenge.attachments.map((file) => ({ id: file.id, name: file.originalName, size: file.size })),
      },
    });
    return;
  }

  const shown = await visibleSolves(req);
  const [solveCount, solve, unlocks] = await Promise.all([
    prisma.solve.count({ where: { challengeId: id, ...shown.where } }),
    prisma.solve.findUnique({
      where: { userId_challengeId: { userId: user.id, challengeId: id } },
      select: { solvedAt: true, points: true, bonus: true, playerName: true },
    }),
    prisma.hintUnlock.findMany({
      where: { userId: user.id, hint: { challengeId: id } },
      select: { hintId: true },
    }),
  ]);
  const unlocked = new Set(unlocks.map((unlock) => unlock.hintId));

  res.json({
    challenge: {
      id: challenge.id,
      title: challenge.title,
      slug: challenge.slug,
      description: challenge.description,
      category: challenge.category,
      difficulty: challenge.difficulty,
      practice: false,
      points: challengeValue(challenge, solveCount),
      scoring: challenge.scoring,
      initialPoints: challenge.points,
      minimumPoints: challenge.scoring === 'DYNAMIC' ? challenge.minimumPoints : null,
      decay: challenge.scoring === 'DYNAMIC' ? challenge.decay : null,
      enabled: challenge.enabled,
      solves: solveCount,
      solved: Boolean(solve),
      solvedAt: solve?.solvedAt.toISOString() ?? null,
      solvedBy: solve?.playerName ?? null,
      pointsAwarded: solve ? solve.points + solve.bonus : null,
      firstBlood:
        challenge.firstBlood && shown.visible(challenge.firstBlood.createdAt, challenge.firstBlood.userId)
          ? {
              username: challenge.firstBlood.user.username,
              at: challenge.firstBlood.createdAt.toISOString(),
              bonus: challenge.firstBlood.bonus,
            }
          : null,
      // Hint text is only included once it is free, unlocked, or the viewer is an admin.
      hints: challenge.hints.map((hint, index) => {
        const visible = hint.cost === 0 || unlocked.has(hint.id) || user.role === 'admin';
        return {
          id: hint.id,
          number: index + 1,
          cost: hint.cost,
          unlocked: visible,
          content: visible ? hint.content : null,
        };
      }),
      attachments: challenge.attachments.map((file) => ({
        id: file.id,
        name: file.originalName,
        size: file.size,
      })),
    },
  });
}

/** GET /api/challenges/:id/solves — which crews claimed this treasure, first first. */
export async function listSolves(req: Request, res: Response) {
  const id = idParam(req.params.id);
  const challenge = await prisma.challenge.findFirst({
    where: { id, ...(req.user!.role === 'admin' ? {} : { enabled: true }) },
    select: { practice: true, firstBlood: { select: { userId: true } } },
  });
  if (!challenge || (!challenge.practice && (await challengesHidden(req)))) throw notFound('That challenge does not exist.');

  if (challenge.practice) {
    const where = { challengeId: id, user: COUNTED_SOLVE.user };
    const [total, solves] = await Promise.all([
      prisma.practiceSolve.count({ where }),
      prisma.practiceSolve.findMany({
        where,
        orderBy: [{ solvedAt: 'asc' }, { id: 'asc' }],
        take: 200,
        select: { playerName: true, solvedAt: true, user: { select: { username: true } } },
      }),
    ]);
    res.json({
      total,
      solves: solves.map((solve) => ({ username: solve.user.username, player: solve.playerName, solvedAt: solve.solvedAt.toISOString(), firstBlood: false })),
    });
    return;
  }

  // Same crews as the scoreboard (disabled accounts left out); while frozen, solves up to the freeze.
  const where = { challengeId: id, ...(await visibleSolves(req)).where };
  const [total, solves] = await Promise.all([
    prisma.solve.count({ where }),
    prisma.solve.findMany({
      where,
      orderBy: [{ solvedAt: 'asc' }, { id: 'asc' }],
      take: 200,
      select: {
        userId: true,
        playerName: true,
        solvedAt: true,
        user: { select: { username: true } },
      },
    }),
  ]);
  res.json({
    total,
    solves: solves.map((solve) => ({
      username: solve.user.username,
      player: solve.playerName,
      solvedAt: solve.solvedAt.toISOString(),
      firstBlood: challenge.firstBlood?.userId === solve.userId,
    })),
  });
}

/** POST /api/challenges/:id/submit */
export async function submit(req: Request, res: Response) {
  const id = idParam(req.params.id);
  const { flag } = submitFlagSchema.parse(req.body);
  const result = await submitFlag(req.user!, id, flag, req.ip ?? null, req.player);
  res.json(result);
}

/** POST /api/challenges/:id/hints/:hintId/unlock */
export async function revealHint(req: Request, res: Response) {
  const challengeId = idParam(req.params.id);
  const hintId = idParam(req.params.hintId);
  const target = await prisma.challenge.findUnique({ where: { id: challengeId }, select: { practice: true } });
  if (!target?.practice && (await challengesHidden(req))) throw notFound('That hint does not exist.');
  res.json({
    hint: await unlockHint(req.user!, challengeId, hintId, req.player),
  });
}

/**
 * GET /api/challenges/:id/attachments/:attachmentId
 * Authenticated download. The on-disk path is built only from database
 * values (a random stored name), never from anything in the request.
 */
export async function downloadAttachment(req: Request, res: Response) {
  const challengeId = idParam(req.params.id);
  const attachmentId = idParam(req.params.attachmentId);

  const attachment = await prisma.attachment.findFirst({
    where: {
      id: attachmentId,
      challengeId,
      challenge: req.user!.role === 'admin' ? undefined : { enabled: true },
    },
    select: { originalName: true, storedName: true, challenge: { select: { practice: true } } },
  });
  if (!attachment || (!attachment.challenge.practice && (await challengesHidden(req)))) throw notFound('That file does not exist.');

  const directory = challengeUploadDir(challengeId);
  const filePath = path.resolve(directory, attachment.storedName);
  // Defence in depth: the resolved path must stay inside the challenge directory.
  if (path.dirname(filePath) !== directory || !fs.existsSync(filePath)) throw notFound('That file does not exist.');

  res.set({
    'Content-Type': 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  // `root` confines the lookup to the challenge directory (and keeps a dot in
  // the uploads path, e.g. /srv/.data/uploads, from being treated as a dotfile).
  res.download(attachment.storedName, attachment.originalName, {
    root: directory,
    dotfiles: 'deny',
  });
}
