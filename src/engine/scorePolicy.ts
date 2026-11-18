export const SIGNAL_SCORING_POLICY_VERSION = 3;
export const SCANNER_RAW_SCORE_MAX = 113;
export const STRATEGY_RAW_SCORE_MAX = 16;
const SCORE_LINEAR_CEILING = 85;

export function normalizeRawConfluenceScore(rawScore: number, rawMaximum: number): number {
  if (!Number.isFinite(rawScore) || !Number.isFinite(rawMaximum) || rawMaximum <= SCORE_LINEAR_CEILING) {
    throw new RangeError('Confluence score and its maximum must be finite, and the maximum must exceed 85.');
  }

  const boundedRawScore = Math.max(0, Math.min(rawMaximum, rawScore));
  const normalized = boundedRawScore <= SCORE_LINEAR_CEILING
    ? boundedRawScore
    : SCORE_LINEAR_CEILING +
      ((boundedRawScore - SCORE_LINEAR_CEILING) / (rawMaximum - SCORE_LINEAR_CEILING)) *
        (100 - SCORE_LINEAR_CEILING);
  return Math.round(normalized * 10) / 10;
}

export function capPositiveMacroContribution(rawScore: number): number {
  if (!Number.isFinite(rawScore)) {
    throw new RangeError('Macro score contribution must be finite.');
  }
  return Math.min(10, rawScore);
}

export function normalizeRawStrategyScore(rawScore: number): number {
  return normalizeRawConfluenceScore(rawScore * 10, STRATEGY_RAW_SCORE_MAX * 10);
}
