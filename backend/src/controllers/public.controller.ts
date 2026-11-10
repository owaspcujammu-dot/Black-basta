import type { Request, Response } from 'express';
import { prisma } from '../db';
import { getEvent, getPublicRank, getPublicScoreboard, isFrozen, publicEvent } from '../services/event.service';
import { openStream } from '../services/realtime.service';
import { getFrozenScoreHistory, getScoreHistory, playerBreakdown } from '../services/scoreboard.service';
import { HttpError } from '../utils/errors';

/** GET /api/health */
export async function health(_req: Request, res: Response) {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: 'ok', time: new Date().toISOString() });
}

/** GET /api/event — public event info for the landing page and countdowns. */
export async function eventInfo(_req: Request, res: Response) {
  res.json({ event: await publicEvent() });
}

/** GET /api/scoreboard */
export async function scoreboard(_req: Request, res: Response) {
  res.json(await getPublicScoreboard());
}

/** GET /api/scoreboard/history — score over time for the leading teams, from the start of the event. */
export async function scoreHistory(_req: Request, res: Response) {
  const [event, board] = await Promise.all([getEvent(), getPublicScoreboard()]);
  // Frozen: the graph stops at the freeze, with the frozen leaders.
  const frozenAt = isFrozen(event) && board.frozenAt ? event.freezeAt! : null;
  res.json({
    from: event.startedAt?.toISOString() ?? null,
    to: (frozenAt ?? event.endedAt ?? new Date()).toISOString(),
    frozenAt: frozenAt?.toISOString() ?? null,
    series: frozenAt ? await getFrozenScoreHistory(board, frozenAt) : await getScoreHistory(),
  });
}

/** GET /api/stream — Server-Sent Events. */
export async function stream(req: Request, res: Response) {
  const initial: Array<[string, unknown]> = [
    ['event', await publicEvent()],
    ['scoreboard', await getPublicScoreboard()],
  ];
  if (!openStream(req, res, req.user?.id ?? null, req.user ? (req.auth?.sid ?? null) : null, initial)) {
    throw new HttpError(503, 'STREAM_FULL', 'Live updates are at capacity. The page still works; refresh to update.');
  }
}

/** GET /api/announcements */
export async function listAnnouncements(_req: Request, res: Response) {
  const announcements = await prisma.announcement.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  res.json({ announcements });
}

/** GET /api/profile — always the caller's own profile; there is no user id to tamper with. */
export async function profile(req: Request, res: Response) {
  const user = req.user!;
  const event = await getEvent();
  const visible = user.role === 'admin' || event.state !== 'UPCOMING';

  const [totalSubmissions, correctSubmissions, firstBloods, solves, achievements, earned, totalChallenges, rank, hintSpend, players] = await Promise.all([
    prisma.submission.count({ where: { userId: user.id } }),
    prisma.submission.count({ where: { userId: user.id, correct: true } }),
    prisma.firstBlood.count({ where: { userId: user.id } }),
    prisma.solve.findMany({
      where: { userId: user.id },
      orderBy: { solvedAt: 'desc' },
      select: {
        points: true,
        bonus: true,
        solvedAt: true,
        playerName: true,
        challenge: { select: { id: true, title: true, difficulty: true, category: { select: { name: true } }, firstBlood: { select: { userId: true } } } },
      },
    }),
    prisma.achievement.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.userAchievement.findMany({ where: { userId: user.id }, select: { achievementId: true, awardedAt: true } }),
    visible ? prisma.challenge.count({ where: { enabled: true, practice: false } }) : Promise.resolve(0),
    getPublicRank(user.id),
    prisma.hintUnlock.aggregate({ where: { userId: user.id }, _sum: { cost: true } }),
    user.role === 'participant' ? playerBreakdown([user]) : Promise.resolve(new Map()),
  ]);
  const earnedAt = new Map(earned.map((row) => [row.achievementId, row.awardedAt]));

  res.json({
    profile: {
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      teamName: user.teamName,
      members: user.members,
      /** Each team member's points. */
      players: players.get(user.id) ?? [],
      /** Who is playing on this device (team logins). */
      player: req.player ?? null,
      role: user.role,
      participantNumber: user.participantNumber,
      rank,
      score: user.score,
      solved: user.solvedCount,
      totalChallenges,
      submissions: totalSubmissions,
      accuracy: totalSubmissions > 0 ? Math.round((correctSubmissions / totalSubmissions) * 100) : null,
      firstBloods,
      hintSpend: hintSpend._sum.cost ?? 0,
      solves: solves.map((solve) => ({
        challengeId: solve.challenge.id,
        title: solve.challenge.title,
        category: solve.challenge.category.name,
        difficulty: solve.challenge.difficulty,
        points: solve.points + solve.bonus,
        firstBlood: solve.challenge.firstBlood?.userId === user.id,
        solvedBy: solve.playerName,
        solvedAt: solve.solvedAt.toISOString(),
      })),
      achievements: achievements.map((achievement) => ({
        code: achievement.code,
        name: achievement.name,
        description: achievement.description,
        icon: achievement.icon,
        earned: earnedAt.has(achievement.id),
        awardedAt: earnedAt.get(achievement.id)?.toISOString() ?? null,
      })),
    },
  });
}
