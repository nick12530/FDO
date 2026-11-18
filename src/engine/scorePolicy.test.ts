import { describe, expect, it } from 'vitest';
import {
  normalizeTenPointScore,
  normalizeWeightedScore,
  SIGNAL_SCORING_POLICY_VERSION,
} from './scorePolicy';

describe('signal scoring policy', () => {
  it('clamps raw weighted scores at the 0-100 boundary without lowering stronger candidates', () => {
    const scores = [99, 100, 101].map(normalizeWeightedScore);

    expect(scores).toEqual([99, 100, 100]);
    expect(scores.every((score) => score >= 65)).toBe(true);
  });

  it('normalizes legacy ten-point strategy weights into the shared score unit', () => {
    expect(normalizeTenPointScore(6.5)).toBe(65);
  });

  it('identifies the active scoring policy version', () => {
    expect(SIGNAL_SCORING_POLICY_VERSION).toBe(2);
  });
});
