import { describe, expect, it } from 'vitest';
import { evaluateMacroSurpriseConfluence } from './macroSurpriseEngine';

describe('macro surprise confluence', () => {
  const usdCpi = {
    id: 'usd-cpi',
    time: '2026-11-18T10:00:00.000Z',
    currency: 'USD' as const,
    event: 'CPI',
    impact: 'high' as const,
    forecast: '2.0',
    previous: '1.9',
    minutesRemaining: -5,
    actual: '3.0',
    surpriseDirection: 'BULLISH' as const,
  };

  it('retains a negative macro headwind for an opposing EURUSD direction', () => {
    const result = evaluateMacroSurpriseConfluence('EURUSD', 'BUY', [usdCpi]);

    expect(result.scoreBonus).toBe(-2);
    expect(result.reasons[0]).toContain('Macro Headwind Warning');
  });

  it('scores an aligned release separately from an opposing trade', () => {
    expect(evaluateMacroSurpriseConfluence('EURUSD', 'SELL', [usdCpi]).scoreBonus).toBe(1.5);
  });
});
