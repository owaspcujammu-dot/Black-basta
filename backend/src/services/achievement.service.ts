import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { getScoreboard } from './scoreboard.service';

export const ACHIEVEMENTS = [
  { code: 'SET_SAIL', name: 'Set Sail', description: 'Solve your first challenge.', icon: 'sailboat', sortOrder: 1 },
  { code: 'FIRST_BLOOD', name: 'First Blood', description: 'Solve a challenge before everyone else.', icon: 'swords', sortOrder: 2 },
  { code: 'TREASURE_HUNTER', name: 'Treasure Hunter', description: 'Solve 10 challenges.', icon: 'coins', sortOrder: 3 },
  { code: 'GRAND_LINE_SURVIVOR', name: 'Grand Line Survivor', description: 'Solve challenges from 5 categories.', icon: 'compass', sortOrder: 4 },
  { code: 'PIRATE_KING', name: 'Pirate King', description: 'Finish #1 on the leaderboard.', icon: 'crown', sortOrder: 5 },
] as const;

export type AchievementCode = (typeof ACHIEVEMENTS)[number]['code'];

export interface AwardedAchievement {
  code: string;
  name: string;
  description: string;
  icon: string;
}

async function award(tx: Prisma.TransactionClient, userId: number, codes: AchievementCode[]): Promise<AwardedAchievement[]> {
  if (codes.length === 0) return [];
  const achievements = await tx.achievement.findMany({
    where: { code: { in: codes }, users: { none: { userId } } },
    select: { id: true, code: true, name: true, description: true, icon: true },
  });
  if (achievements.length === 0) return [];
  await tx.userAchievement.createMany({
    data: achievements.map((achievement) => ({ userId, achievementId: achievement.id })),
    skipDuplicates: true,
  });
  return achievements.map(({ code, name, description, icon }) => ({ code, name, description, icon }));
}

/** Runs inside the solve transaction. Returns only achievements earned by this solve. */
export async function awardSolveAchievements(
  tx: Prisma.TransactionClient,
  userId: number,
  context: { firstBlood: boolean; solvedCount: number },
): Promise<AwardedAchievement[]> {
  const codes: AchievementCode[] = [];
  if (context.solvedCount >= 1) codes.push('SET_SAIL');
  if (context.firstBlood) codes.push('FIRST_BLOOD');
  if (context.solvedCount >= 10) codes.push('TREASURE_HUNTER');
  if (context.solvedCount >= 5) {
    const categories = await tx.solve.findMany({
      where: { userId },
      select: { challenge: { select: { categoryId: true } } },
    });
    if (new Set(categories.map((solve) => solve.challenge.categoryId)).size >= 5) codes.push('GRAND_LINE_SURVIVOR');
  }
  return award(tx, userId, codes);
}

/** Called when the event ends: whoever tops the final leaderboard is crowned. */
export async function awardPirateKing(): Promise<void> {
  const board = await getScoreboard();
  const champion = board.entries[0];
  if (!champion || champion.score <= 0) return;
  await prisma.$transaction((tx) => award(tx, champion.userId, ['PIRATE_KING']));
}
