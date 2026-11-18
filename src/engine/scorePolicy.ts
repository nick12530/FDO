export const SIGNAL_SCORING_POLICY_VERSION = 2;

export function normalizeWeightedScore(rawScore: number): number {
  if (!Number.isFinite(rawScore)) {
    throw new RangeError('Signal score must be a finite number.');
  }
  return Math.round(Math.max(0, Math.min(100, rawScore)) * 10) / 10;
}

export function normalizeTenPointScore(rawScore: number): number {
  return normalizeWeightedScore(rawScore * 10);
}
