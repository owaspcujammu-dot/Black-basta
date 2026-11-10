/** Same formula as the server (backend/src/utils/scoring.ts): value with `solveCount` solves. */
export function dynamicValue(initial: number, minimum: number, decay: number, solveCount: number): number {
  if (decay <= 0 || minimum >= initial) return initial;
  const after = Math.max(0, solveCount - 1);
  const value = Math.ceil(initial + ((minimum - initial) * after * after) / (decay * decay));
  return Math.min(initial, Math.max(minimum, value));
}
