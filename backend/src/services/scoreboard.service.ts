import { config } from '../config';
import { prisma } from '../db';
import { COUNTED_SOLVE, challengeValue } from '../utils/scoring';
import { broadcast } from './realtime.service';

/** One team member's share of the team score. */
export interface PlayerScore {
  name: string;
  score: number;
  solved: number;
}

export interface ScoreboardEntry {
  rank: number;
  userId: number;
  username: string;
  teamName: string | null;
  /** Team members with their own points (team mode). Unattributed points are listed as "Unassigned". */
  players: PlayerScore[];
  score: number;
  solved: number;
  lastCapture: string | null;
  /** Pirate-themed rank title derived from the position. */
  title: string;
}

export interface Scoreboard {
  entries: ScoreboardEntry[];
  generatedAt: string;
  /** Set while the scoreboard is frozen: the board shown is as it was at this time. */
  frozenAt?: string | null;
}

export function pirateTitle(rank: number, score: number): string {
  if (score <= 0) return 'Deckhand';
  if (rank === 1) return 'Pirate King';
  if (rank <= 4) return 'Emperor of the Sea';
  if (rank <= 10) return 'Warlord';
  if (rank <= 25) return 'Supernova';
  if (rank <= 50) return 'Captain';
  return 'First Mate';
}

const UNASSIGNED_PLAYER = 'Unassigned';
// Player names cannot contain '#', so this never collides with a real player.
const UNASSIGNED_KEY = '#unassigned';

/**
 * Splits team scores by player, from the solve and hint ledgers: a player's
 * points are what they solved minus the hints they bought. Every listed member
 * appears (with 0 if they have not scored); solves from before player names were
 * recorded go under "Unassigned".
 */
export async function playerBreakdown(teams: { id: number; members: string[] }[]): Promise<Map<number, PlayerScore[]>> {
  const userIds = teams.map((team) => team.id);
  const [solves, hints] = await Promise.all([
    prisma.solve.groupBy({ by: ['userId', 'playerName'], where: { userId: { in: userIds } }, _sum: { points: true, bonus: true }, _count: { _all: true } }),
    prisma.hintUnlock.groupBy({ by: ['userId', 'playerName'], where: { userId: { in: userIds }, cost: { gt: 0 } }, _sum: { cost: true } }),
  ]);

  const result = new Map<number, PlayerScore[]>();
  const tally = new Map<number, Map<string, PlayerScore>>();
  for (const team of teams) {
    const players = new Map<string, PlayerScore>();
    for (const name of team.members) players.set(name.toLowerCase(), { name, score: 0, solved: 0 });
    tally.set(team.id, players);
  }
  const entry = (userId: number, playerName: string | null) => {
    const players = tally.get(userId)!;
    const name = playerName ?? UNASSIGNED_PLAYER;
    const key = playerName ? playerName.toLowerCase() : UNASSIGNED_KEY;
    let player = players.get(key);
    if (!player) players.set(key, (player = { name, score: 0, solved: 0 }));
    return player;
  };
  for (const row of solves) {
    const player = entry(row.userId, row.playerName);
    player.score += (row._sum.points ?? 0) + (row._sum.bonus ?? 0);
    player.solved += row._count._all;
  }
  for (const row of hints) entry(row.userId, row.playerName).score -= row._sum.cost ?? 0;

  for (const [userId, players] of tally) {
    // A solo account (no members, nothing recorded per player) has no breakdown to show.
    if (players.size === 1 && players.has(UNASSIGNED_KEY)) players.clear();
    result.set(
      userId,
      [...players.values()].sort((a, b) => b.score - a.score || b.solved - a.solved || a.name.localeCompare(b.name)),
    );
  }
  return result;
}

// The scoreboard is read far more often than it changes, so it is computed once
// and kept in memory until a score changes.
let cache: Promise<Scoreboard> | null = null;
let broadcastTimer: NodeJS.Timeout | null = null;
let lastBroadcast = 0;

async function compute(): Promise<Scoreboard> {
  const users = await prisma.user.findMany({
    where: { role: 'participant', disabled: false },
    // Ranking rules: higher score first; ties go to whoever reached that score earlier.
    orderBy: [{ score: 'desc' }, { scoreReachedAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
    select: { id: true, username: true, teamName: true, members: true, score: true, solvedCount: true, lastSolveAt: true },
  });
  const players = await playerBreakdown(users);

  return {
    generatedAt: new Date().toISOString(),
    entries: users.map((user, index) => ({
      rank: index + 1,
      userId: user.id,
      username: user.username,
      teamName: user.teamName,
      players: players.get(user.id) ?? [],
      score: user.score,
      solved: user.solvedCount,
      lastCapture: user.lastSolveAt ? user.lastSolveAt.toISOString() : null,
      title: pirateTitle(index + 1, user.score),
    })),
  };
}

/** Teams shown on the score graph: the leaders, capped so every line keeps a distinct, colour-blind-safe colour. */
const HISTORY_TEAMS = 8;

export interface ScoreHistorySeries {
  userId: number;
  username: string;
  rank: number;
  /** Every score change, oldest first. */
  points: { at: string; score: number }[];
}

let historyCache: Promise<ScoreHistorySeries[]> | null = null;
let frozenHistoryCache: { key: string; history: Promise<ScoreHistorySeries[]> } | null = null;

/** The leaders of `board`, with their score changes up to `until` (all of them when null). */
async function computeHistory(board: Scoreboard, until: Date | null): Promise<ScoreHistorySeries[]> {
  const leaders = board.entries.filter((entry) => entry.solved > 0).slice(0, HISTORY_TEAMS);
  if (leaders.length === 0) return [];
  const events = await prisma.scoreEvent.findMany({
    where: { userId: { in: leaders.map((entry) => entry.userId) }, ...(until ? { createdAt: { lte: until } } : {}) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { userId: true, scoreAfter: true, createdAt: true },
  });
  const byUser = new Map<number, ScoreHistorySeries['points']>(leaders.map((entry) => [entry.userId, []]));
  for (const event of events) byUser.get(event.userId)!.push({ at: event.createdAt.toISOString(), score: event.scoreAfter });
  return leaders.map((entry) => ({ userId: entry.userId, username: entry.username, rank: entry.rank, points: byUser.get(entry.userId) ?? [] }));
}

/** Score over time for the leading teams (the scoreboard graph). Cached like the scoreboard. */
export function getScoreHistory(): Promise<ScoreHistorySeries[]> {
  if (!historyCache) {
    historyCache = getScoreboard()
      .then((board) => computeHistory(board, null))
      .catch((error) => {
        historyCache = null;
        throw error;
      });
  }
  return historyCache;
}

/** The graph as it stood when the scoreboard froze: the frozen leaders, changes up to the freeze. */
export function getFrozenScoreHistory(board: Scoreboard, frozenAt: Date): Promise<ScoreHistorySeries[]> {
  const key = `${frozenAt.toISOString()}|${board.generatedAt}`;
  if (frozenHistoryCache?.key !== key) {
    const history = computeHistory(board, frozenAt).catch((error) => {
      frozenHistoryCache = null;
      throw error;
    });
    frozenHistoryCache = { key, history };
  }
  return frozenHistoryCache.history;
}

export function getScoreboard(): Promise<Scoreboard> {
  if (!cache) {
    cache = compute().catch((error) => {
      cache = null;
      throw error;
    });
  }
  return cache;
}

/**
 * The board pushed to browsers after a score change, or null to push nothing.
 * Set by the event service: while the scoreboard is frozen nothing is pushed
 * (the frozen board does not change).
 */
let pushableBoard: () => Promise<Scoreboard | null> = getScoreboard;
export function setPushableBoard(provider: () => Promise<Scoreboard | null>) {
  pushableBoard = provider;
}

/**
 * Call after any score change. Bursts are coalesced, and pushes go out at most
 * once per SCOREBOARD_PUSH_MS: every push sends the whole board to every open
 * browser, so during a busy event this is what bounds the upload bandwidth.
 */
export function invalidateScoreboard() {
  cache = null;
  historyCache = null;
  if (broadcastTimer) return;
  const wait = Math.max(400, lastBroadcast + config.scoreboardPushMs - Date.now());
  broadcastTimer = setTimeout(async () => {
    broadcastTimer = null;
    lastBroadcast = Date.now();
    try {
      const board = await pushableBoard();
      if (board) broadcast('scoreboard', board);
    } catch (error) {
      console.error('[scoreboard] broadcast failed', error);
    }
  }, wait);
  broadcastTimer.unref();
}

/**
 * Puts every dynamic challenge back on its curve for its current solve count
 * (after a crew is deleted or disabled, or the challenge's scoring was edited).
 */
async function revalueDynamicChallenges(): Promise<void> {
  const dynamic = await prisma.challenge.findMany({
    where: { scoring: 'DYNAMIC' },
    select: { id: true, points: true, scoring: true, minimumPoints: true, decay: true },
  });
  for (const challenge of dynamic) {
    const value = challengeValue(challenge, await prisma.solve.count({ where: { challengeId: challenge.id, ...COUNTED_SOLVE } }));
    await prisma.solve.updateMany({ where: { challengeId: challenge.id, points: { not: value } }, data: { points: value } });
  }
}

/**
 * Rebuilds every participant's score from the solve and hint ledgers.
 * Used after an admin deletes a challenge or changes its point value.
 */
export async function recalculateScores(): Promise<void> {
  await revalueDynamicChallenges();
  const [users, solves, hints] = await Promise.all([
    prisma.user.findMany({ where: { role: 'participant' }, select: { id: true, score: true, solvedCount: true } }),
    prisma.solve.groupBy({ by: ['userId'], _sum: { points: true, bonus: true }, _count: { _all: true }, _max: { solvedAt: true } }),
    prisma.hintUnlock.groupBy({ by: ['userId'], _sum: { cost: true }, _max: { unlockedAt: true } }),
  ]);

  const solveByUser = new Map(solves.map((row) => [row.userId, row]));
  const hintByUser = new Map(hints.map((row) => [row.userId, row]));

  for (const user of users) {
    const solve = solveByUser.get(user.id);
    const hint = hintByUser.get(user.id);
    const score = (solve?._sum.points ?? 0) + (solve?._sum.bonus ?? 0) - (hint?._sum.cost ?? 0);
    const solvedCount = solve?._count._all ?? 0;
    if (score === user.score && solvedCount === user.solvedCount) continue;

    const lastSolveAt = solve?._max.solvedAt ?? null;
    const lastHintAt = hint?._max.unlockedAt ?? null;
    const scoreReachedAt = [lastSolveAt, lastHintAt].filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { score, solvedCount, lastSolveAt, scoreReachedAt } }),
      prisma.scoreEvent.create({ data: { userId: user.id, delta: score - user.score, scoreAfter: score, reason: 'RECALCULATED' } }),
    ]);
  }

  invalidateScoreboard();
}
