import { describe, expect, it } from 'vitest';
import type { Candle } from '../types/smc';
import { calculateRVOL, evaluateVolumeConfluence } from './volumeEngine';

const candle = (time: number, volume: number): Candle => ({
  time,
  timeStr: '12:00',
  open: 100,
  high: 101,
  low: 99,
  close: 100.2,
  volume,
});

describe('broker tick-volume proxy', () => {
  it('marks insufficient broker volume unavailable instead of inventing neutral RVOL', () => {
    const candles = [candle(1, 0), candle(2, 0), candle(3, 0)];

    expect(calculateRVOL(candles)).toMatchObject({
      available: false,
      rvol: 0,
      currentVolume: 0,
      avgVolume20: 0,
    });
    expect(evaluateVolumeConfluence(candles, 'BUY')).toMatchObject({
      scoreBonus: 0,
      metrics: { available: false },
      reasons: ['Tick-volume proxy unavailable; omitted from confluence.'],
    });
  });

  it('computes RVOL from the current broker tick volume and prior positive observations', () => {
    const candles = [
      candle(1, 100),
      candle(2, 100),
      candle(3, 100),
      candle(4, 100),
      candle(5, 100),
      candle(6, 250),
    ];

    expect(calculateRVOL(candles)).toMatchObject({
      available: true,
      currentVolume: 250,
      avgVolume20: 100,
      rvol: 2.5,
    });
  });
});
