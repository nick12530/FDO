import { describe, expect, it } from 'vitest';
import {
  capPositiveMacroContribution,
  normalizeRawConfluenceScore,
  normalizeRawStrategyScore,
  SCANNER_RAW_SCORE_MAX,
  SIGNAL_SCORING_POLICY_VERSION,
  STRATEGY_RAW_SCORE_MAX,
} from './scorePolicy';

describe('signal scoring policy', () => {
  it('preserves ranking for strong raw scores while smoothly compressing the upper tail', () => {
    const scores = [99, 100, 101].map((score) =>
      normalizeRawConfluenceScore(score, SCANNER_RAW_SCORE_MAX)
    );

    expect(scores).toEqual([92.5, 93, 93.6]);
    expect(scores[0]).toBeLessThan(scores[1]);
    expect(scores[1]).toBeLessThan(scores[2]);
    expect(scores.every((score) => score >= 65)).toBe(true);
    expect(normalizeRawConfluenceScore(SCANNER_RAW_SCORE_MAX, SCANNER_RAW_SCORE_MAX)).toBe(100);
    expect(normalizeRawConfluenceScore(-1, SCANNER_RAW_SCORE_MAX)).toBe(0);
  });

  it('normalizes explicit raw strategy points into the shared score unit', () => {
    expect(normalizeRawStrategyScore(6.5)).toBe(65);
    expect(normalizeRawStrategyScore(10)).toBe(88);
    expect(normalizeRawStrategyScore(11)).toBe(90);
    expect(normalizeRawStrategyScore(STRATEGY_RAW_SCORE_MAX)).toBe(100);
  });

  it('keeps normalized strategy scores ordered across the high-score boundary', () => {
    const scores = [8.4, 8.5, 8.6].map(normalizeRawStrategyScore);
    expect(scores[0]).toBeLessThan(scores[1]);
    expect(scores[1]).toBeLessThan(scores[2]);
  });

  it('preserves negative macro contributions and caps only their positive maximum', () => {
    expect(capPositiveMacroContribution(-8)).toBe(-8);
    expect(capPositiveMacroContribution(14)).toBe(10);
  });

  it('identifies the active scoring policy version', () => {
    expect(SIGNAL_SCORING_POLICY_VERSION).toBe(3);
  });
});
