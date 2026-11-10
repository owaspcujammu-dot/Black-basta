import { config } from '../config';
import { prisma } from '../db';
import { HttpError, notFound } from '../utils/errors';
import { EXTRA_FLAG_REGEX, FLAG_FORMAT, isWellFormedFlag, matchesAnyFlag } from '../utils/flags';
import { COUNTED_SOLVE, challengeValue } from '../utils/scoring';
import { truncate } from '../utils/text';
import { awardSolveAchievements, type AwardedAchievement } from './achievement.service';
import { assertEventLive, getEvent, isFrozen } from './event.service';
import { broadcast } from './realtime.service';
import { invalidateScoreboard } from './scoreboard.service';

const WRONG_FLAG_MESSAGE = 'The treasure remains hidden.';

export type SubmitResult =
  | { correct: false; message: string; formatHint?: string }
  | { correct: true; test: true; message: string }
  /** Practice challenges: recorded for the crew, never scored. */
  | { correct: true; practice: true; alreadySolved: boolean; message: string }
  | { correct: true; alreadySolved: true; pointsAwarded: 0; message: string }
  | {
      correct: true;
      alreadySolved: false;
      pointsAwarded: number;
      basePoints: number;
      firstBlood: boolean;
      firstBloodBonus: number;
      newScore: number;
      achievements: AwardedAchievement[];
      message: string;
    };

interface Submitter {
  id: number;
  username: string;
  role: 'participant' | 'admin';
}

/** Team member playing on the submitting device (team logins), or null. */
type Player = string | null | undefined;

/**
 * Validates a flag entirely on the server. The response never indicates how
 * close a wrong flag was — only correct / incorrect.
 */
export async function submitFlag(user: Submitter, challengeId: number, rawFlag: string, ip: string | null, player: Player = null): Promise<SubmitResult> {
  const playerName = player ?? null;
  const isAdmin = user.role === 'admin';

  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
    select: {
      id: true,
      title: true,
      points: true,
      scoring: true,
      minimumPoints: true,
      decay: true,
      flagHash: true,
      flagSalt: true,
      flagCaseInsensitive: true,
      extraFlags: { select: { flagHash: true, flagSalt: true } },
      enabled: true,
      practice: true,
    },
  });
  // Practice challenges are open at any time; competition flags only while the CTF is live.
  if (!isAdmin && !challenge?.practice) await assertEventLive();
  if (!challenge || (!challenge.enabled && !isAdmin)) throw notFound('That challenge does not exist.');

  const flag = rawFlag.trim();
  // The main flag or any extra accepted flag (all hashes are always checked).
  const correct = matchesAnyFlag(flag, challenge.flagCaseInsensitive, [challenge, ...challenge.extraFlags]);
  const wellFormed = isWellFormedFlag(flag) || EXTRA_FLAG_REGEX.test(flag);

  // Admins can test flags, but never appear on the scoreboard or take first blood.
  if (isAdmin) {
    return correct
      ? { correct: true, test: true, message: 'Flag is correct (admin test — nothing was recorded).' }
      : { correct: false, message: WRONG_FLAG_MESSAGE };
  }

  if (challenge.practice) return submitPractice(user.id, challengeId, correct, wellFormed, playerName);

  const existing = await prisma.solve.findUnique({
    where: { userId_challengeId: { userId: user.id, challengeId } },
    select: { id: true },
  });
  if (existing) {
    return { correct: true, alreadySolved: true, pointsAwarded: 0, message: 'You already claimed this treasure.' };
  }

  if (!correct) {
    await prisma.submission.create({
      data: { userId: user.id, challengeId, playerName, submittedFlag: truncate(flag, 255), correct: false, ip },
    });
    return {
      correct: false,
      message: WRONG_FLAG_MESSAGE,
      ...(wellFormed ? {} : { formatHint: `Flags use the format ${FLAG_FORMAT}` }),
    };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    // One solve of a challenge at a time: a dynamic value depends on the exact solve count.
    await tx.$queryRaw`SELECT id FROM "Challenge" WHERE id = ${challengeId} FOR UPDATE`;

    // ON CONFLICT DO NOTHING: a concurrent duplicate request cannot award points twice.
    const solve = await tx.solve.createMany({
      data: [{ userId: user.id, challengeId, playerName, points: challenge.points }],
      skipDuplicates: true,
    });
    if (solve.count === 0) return null;

    // Dynamic challenges: the value drops with this solve, for every crew that holds it.
    const now = new Date();
    let value = challenge.points;
    if (challenge.scoring === 'DYNAMIC') {
      value = challengeValue(challenge, await tx.solve.count({ where: { challengeId, ...COUNTED_SOLVE } }));
      const lowered = await tx.$queryRaw<{ id: number; score: number; delta: number }[]>`
        UPDATE "User" AS u SET score = u.score + (${value} - s.points)
        FROM "Solve" AS s
        WHERE s."challengeId" = ${challengeId} AND s."userId" = u.id AND s."userId" <> ${user.id} AND s.points <> ${value}
        RETURNING u.id, u.score, (${value} - s.points) AS delta`;
      await tx.solve.updateMany({ where: { challengeId, points: { not: value } }, data: { points: value } });
      if (lowered.length > 0) {
        await tx.scoreEvent.createMany({
          data: lowered.map((row) => ({ userId: row.id, delta: Number(row.delta), scoreAfter: row.score, reason: 'DECAY' as const, createdAt: now })),
        });
      }
    }

    // The unique index on challengeId decides first blood, even under a race.
    const blood = await tx.firstBlood.createMany({
      data: [{ challengeId, userId: user.id, bonus: config.firstBloodBonus }],
      skipDuplicates: true,
    });
    const firstBlood = blood.count === 1;
    const bonus = firstBlood ? config.firstBloodBonus : 0;
    if (bonus > 0) {
      await tx.solve.update({ where: { userId_challengeId: { userId: user.id, challengeId } }, data: { bonus } });
    }

    const total = value + bonus;
    const updated = await tx.user.update({
      where: { id: user.id },
      data: { score: { increment: total }, solvedCount: { increment: 1 }, lastSolveAt: now, scoreReachedAt: now },
      select: { score: true, solvedCount: true },
    });
    await tx.scoreEvent.create({
      data: { userId: user.id, delta: total, scoreAfter: updated.score, reason: 'SOLVE', createdAt: now },
    });
    // The real flag is never written to the submissions log.
    await tx.submission.create({
      data: { userId: user.id, challengeId, playerName, submittedFlag: '[redacted: correct flag]', correct: true, ip, submittedAt: now },
    });
    const achievements = await awardSolveAchievements(tx, user.id, { firstBlood, solvedCount: updated.solvedCount });

    return { firstBlood, bonus, total, value, lowered: challenge.scoring === 'DYNAMIC', newScore: updated.score, achievements };
  });

  if (!outcome) {
    return { correct: true, alreadySolved: true, pointsAwarded: 0, message: 'You already claimed this treasure.' };
  }

  invalidateScoreboard();
  // While the scoreboard is frozen, only the crew itself hears about its solve.
  const frozen = isFrozen(await getEvent());
  broadcast(
    'solve',
    { username: user.username, player: playerName, challengeId, challenge: challenge.title, points: outcome.total, firstBlood: outcome.firstBlood },
    frozen ? { userId: user.id } : { authenticatedOnly: true },
  );

  return {
    correct: true,
    alreadySolved: false,
    pointsAwarded: outcome.total,
    basePoints: outcome.value,
    firstBlood: outcome.firstBlood,
    firstBloodBonus: outcome.bonus,
    newScore: outcome.newScore,
    achievements: outcome.achievements,
    message: 'You discovered the hidden treasure!',
  };
}

/**
 * Practice: a correct flag is recorded for the crew (so the practice page shows it
 * solved); nothing is scored, logged as a submission, announced or awarded.
 */
async function submitPractice(userId: number, challengeId: number, correct: boolean, wellFormed: boolean, playerName: string | null): Promise<SubmitResult> {
  if (!correct) {
    return { correct: false, message: WRONG_FLAG_MESSAGE, ...(wellFormed ? {} : { formatHint: `Flags use the format ${FLAG_FORMAT}` }) };
  }
  const created = await prisma.practiceSolve.createMany({ data: [{ userId, challengeId, playerName }], skipDuplicates: true });
  return created.count === 0
    ? { correct: true, practice: true, alreadySolved: true, message: 'Your crew already cracked this practice challenge.' }
    : { correct: true, practice: true, alreadySolved: false, message: 'Correct! Practice treasure found — no points, just glory.' };
}

/** Reveals a hint, charging its cost exactly once. */
export async function unlockHint(user: Submitter, challengeId: number, hintId: number, player: Player = null) {
  const hint = await prisma.hint.findFirst({
    where: { id: hintId, challengeId, challenge: user.role === 'admin' ? undefined : { enabled: true } },
    select: { id: true, content: true, cost: true, challenge: { select: { practice: true } } },
  });
  if (!hint) throw notFound('That hint does not exist.');
  // Admins and practice challenges: hints are free and nothing is charged.
  if (user.role === 'admin' || hint.challenge.practice) return { id: hint.id, content: hint.content, cost: 0, charged: 0, newScore: null };

  const already = await prisma.hintUnlock.findUnique({ where: { userId_hintId: { userId: user.id, hintId } }, select: { id: true } });
  if (!already && hint.cost > 0) await assertEventLive();

  const result = await prisma.$transaction(async (tx) => {
    const unlock = await tx.hintUnlock.createMany({ data: [{ userId: user.id, hintId, cost: hint.cost, playerName: player ?? null }], skipDuplicates: true });
    if (unlock.count === 0 || hint.cost === 0) return { charged: 0, newScore: null as number | null };

    // Conditional decrement: two concurrent unlocks cannot overdraw the score.
    const now = new Date();
    const paid = await tx.user.updateMany({
      where: { id: user.id, score: { gte: hint.cost } },
      data: { score: { decrement: hint.cost }, scoreReachedAt: now },
    });
    if (paid.count === 0) {
      throw new HttpError(400, 'NOT_ENOUGH_BOUNTY', `You need at least ${hint.cost} bounty to reveal this hint.`);
    }
    const updated = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { score: true } });
    await tx.scoreEvent.create({
      data: { userId: user.id, delta: -hint.cost, scoreAfter: updated.score, reason: 'HINT', createdAt: now },
    });
    return { charged: hint.cost, newScore: updated.score };
  });

  if (result.charged > 0) invalidateScoreboard();
  return { id: hint.id, content: hint.content, cost: hint.cost, ...result };
}
