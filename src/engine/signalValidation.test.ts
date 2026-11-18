import { describe, expect, it } from 'vitest';
import type { Candle } from '../types/smc';
import {
  advanceSignalValidation,
  SignalValidationRecord,
  summarizeSignalValidations,
} from './signalValidation';

const sourceTime = Date.parse('2026-10-21T12:00:00Z');
const record: SignalValidationRecord = {
  id: 'XAUUSD-M5-1',
  createdAt: new Date(sourceTime).toISOString(),
  sourceCandleTime: sourceTime,
  generatedAt: new Date(sourceTime).toISOString(),
  availableAt: new Date(sourceTime).toISOString(),
  sourceCandleOpenTime: sourceTime,
  sourceCandleCloseTime: sourceTime,
  expiresAt: sourceTime + 5 * 60_000,
  symbol: 'XAUUSD',
  direction: 'BUY',
  timeframe: 'M5',
  triggerPrice: 100,
  stopLoss: 90,
  takeProfit: 110,
  confluenceScore: 90,
  outcome: 'WATCHING',
};

function candle(time: number, low: number, high: number): Candle {
  return { time, timeStr: '', open: 100, high, low, close: 100, volume: 1 };
}

describe('prospective signal validation', () => {
  it('requires the trigger, then records target-first outcomes from later closed broker candles', () => {
    const first = candle(sourceTime + 60_000, 99, 101);
    const triggered = advanceSignalValidation(record, [first], sourceTime + 122_000);
    expect(triggered.outcome).toBe('WATCHING');
    expect(triggered.triggeredAt).toBe(sourceTime + 60_000);

    const target = candle(sourceTime + 120_000, 99, 111);
    const resolved = advanceSignalValidation(triggered, [first, target], sourceTime + 182_000);
    expect(resolved.outcome).toBe('TARGET_HIT');
    expect(summarizeSignalValidations([resolved]).resolvedWinRate).toBe(100);
  });

  it('marks same-candle trigger and stop/target contact ambiguous instead of claiming a win', () => {
    const ambiguous = candle(sourceTime + 60_000, 89, 111);
    const resolved = advanceSignalValidation(record, [ambiguous], sourceTime + 122_000);
    expect(resolved.outcome).toBe('AMBIGUOUS');
    expect(summarizeSignalValidations([resolved]).resolvedWinRate).toBeNull();
  });

  it('distinguishes untriggered expiry from a triggered setup that expires without resolution', () => {
    const expiredUntriggered = advanceSignalValidation(record, [], record.expiresAt + 1);
    expect(expiredUntriggered.outcome).toBe('EXPIRED_UNTRIGGERED');

    const triggered = {
      ...record,
      triggeredAt: sourceTime + 60_000,
    };
    const expiredOpen = advanceSignalValidation(triggered, [], record.expiresAt + 1);
    expect(expiredOpen.outcome).toBe('EXPIRED_OPEN');
  });

  it('does not consume the still-forming one-minute candle', () => {
    const formingTrigger = candle(sourceTime + 60_000, 99, 101);
    const unchanged = advanceSignalValidation(record, [formingTrigger], sourceTime + 90_000);
    expect(unchanged.outcome).toBe('WATCHING');
    expect(unchanged.triggeredAt).toBeUndefined();
  });

  it('does not credit trigger or target movement before the signal was discovered', () => {
    const discoveredAt = Date.parse('2026-10-21T12:05:00Z');
    const discovered = {
      ...record,
      createdAt: new Date(discoveredAt).toISOString(),
      generatedAt: new Date(discoveredAt).toISOString(),
      availableAt: new Date(discoveredAt).toISOString(),
      expiresAt: discoveredAt + 5 * 60_000,
      sourceCandleOpenTime: sourceTime,
      sourceCandleCloseTime: discoveredAt,
    };
    const earlyTrigger = candle(Date.parse('2026-10-21T12:01:00Z'), 99, 101);
    const earlyTarget = candle(Date.parse('2026-10-21T12:02:00Z'), 99, 111);

    const unchanged = advanceSignalValidation(
      discovered,
      [earlyTrigger, earlyTarget],
      Date.parse('2026-10-21T12:06:01Z')
    );

    expect(unchanged.outcome).toBe('WATCHING');
    expect(unchanged.triggeredAt).toBeUndefined();
  });
});
