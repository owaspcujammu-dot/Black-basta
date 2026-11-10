/**
 * Dynamic challenge value (the CTFd formula): the first crew gets the full
 * `initial` value, and it falls along a curve to `minimum` once `decay` more crews
 * have solved it. Every crew that solved the challenge holds its current value.
 */
export function dynamicValue(initial: number, minimum: number, decay: number, solveCount: number): number {
  if (decay <= 0 || minimum >= initial) return initial;
  const after = Math.max(0, solveCount - 1); // solves after the first
  // Multiply before dividing so whole results stay whole (no 100.00000000001 rounding up to 101).
  const value = Math.ceil(initial + ((minimum - initial) * after * after) / (decay * decay));
  return Math.min(initial, Math.max(minimum, value));
}

export interface ScoringRule {
  points: number;
  scoring: 'STATIC' | 'DYNAMIC';
  minimumPoints: number | null;
  decay: number | null;
}

/** What every solver of this challenge holds when it has `solveCount` (counted) solves. */
export function challengeValue(rule: ScoringRule, solveCount: number): number {
  if (rule.scoring !== 'DYNAMIC') return rule.points;
  return dynamicValue(rule.points, rule.minimumPoints ?? rule.points, rule.decay ?? 0, solveCount);
}

/** Solves that count towards a dynamic value: same crews as the scoreboard. */
export const COUNTED_SOLVE = { user: { role: 'participant' as const, disabled: false } };
