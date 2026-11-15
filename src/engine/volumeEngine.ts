/**
 * volumeEngine.ts - Institutional Volume & Order Flow Footprint Engine
 *
 * Provides:
 * - Relative Volume (RVOL) normalized to rolling 20-period baseline
 * - Institutional Volume Footprint classification:
 *     * DISPLACEMENT: High RVOL (>= 1.8) + Large expansion body (> 50% range)
 *     * ABSORPTION: High RVOL (>= 2.0) + Rejection wick (>= 40% range) soaking up liquidity
 *     * LOW_LIQUIDITY: Thin volume (RVOL < 0.75) prone to retail fakeouts
 *     * NEUTRAL: Normal baseline flow
 * - Cumulative Volume Delta (CVD) proxy
 * - Volume-Weighted Point of Control (POC) and Value Area
 * - Volume Confluence evaluation for SMC setups
 */

import { Candle, VolumeMetrics } from '../types/smc';

export function calculateRVOL(candles: Candle[], lookback: number = 20, digits: number = 2): VolumeMetrics {
  if (candles.length === 0) {
    return {
      currentVolume: 0,
      avgVolume20: 0,
      rvol: 1.0,
      volumeType: 'NEUTRAL',
      cvdDelta: 0,
      isInstitutionalSpike: false,
      isAbsorptionWick: false,
    };
  }

  const latest = candles[candles.length - 1];
  const start = Math.max(0, candles.length - 1 - lookback);
  const baselineSlice = candles.slice(start, candles.length - 1);

  const avgVol = baselineSlice.length > 0
    ? baselineSlice.reduce((sum, c) => sum + (c.volume || 1), 0) / baselineSlice.length
    : (latest.volume || 1);

  const curVol = latest.volume || 1;
  const rawRvol = avgVol > 0 ? curVol / avgVol : 1.0;
  const rvol = Number(rawRvol.toFixed(2));

  const totalRange = Math.max(1e-7, latest.high - latest.low);
  const body = Math.abs(latest.close - latest.open);
  const upperWick = latest.high - Math.max(latest.open, latest.close);
  const lowerWick = Math.min(latest.open, latest.close) - latest.low;

  const bodyRatio = body / totalRange;
  const maxWick = Math.max(upperWick, lowerWick);
  const maxWickRatio = maxWick / totalRange;

  const isAbsorption = rvol >= 1.8 && (maxWickRatio >= 0.40 || bodyRatio <= 0.35);
  const isDisplacement = rvol >= 1.5 && bodyRatio >= 0.50;
  const isInstitutionalSpike = rvol >= 1.8;

  let volumeType: VolumeMetrics['volumeType'] = 'NEUTRAL';
  if (isDisplacement) volumeType = 'DISPLACEMENT';
  else if (isAbsorption) volumeType = 'ABSORPTION';
  else if (rvol < 0.75) volumeType = 'LOW_LIQUIDITY';

  // Calculate Cumulative Volume Delta (CVD) proxy over the last 20 bars
  let cvdDelta = 0;
  for (const c of candles.slice(-20)) {
    const barRange = Math.max(1e-7, c.high - c.low);
    const barDeltaRatio = (c.close - c.open) / barRange; // -1.0 to +1.0
    cvdDelta += (c.volume || 1) * barDeltaRatio;
  }

  // Calculate Point of Control (POC) - price bin with maximum tick volume
  const pocPrice = calculatePOC(candles.slice(-20), 15, digits);

  return {
    currentVolume: curVol,
    avgVolume20: Math.round(avgVol),
    rvol,
    volumeType,
    cvdDelta: Math.round(cvdDelta),
    isInstitutionalSpike,
    isAbsorptionWick: isAbsorption,
    pocPrice,
  };
}

/**
 * Calculates the Point of Control (POC) price level where maximum volume occurred.
 */
function calculatePOC(candles: Candle[], bins: number = 15, digits: number = 2): number | undefined {
  if (candles.length < 5) return undefined;
  let minPrice = Infinity;
  let maxPrice = -Infinity;

  for (const c of candles) {
    if (c.low < minPrice) minPrice = c.low;
    if (c.high > maxPrice) maxPrice = c.high;
  }

  if (maxPrice <= minPrice) return undefined;

  const binSize = (maxPrice - minPrice) / bins;
  const volumeBins = new Array(bins).fill(0);

  for (const c of candles) {
    const mid = (c.open + c.close + c.high + c.low) / 4;
    const binIdx = Math.min(bins - 1, Math.max(0, Math.floor((mid - minPrice) / binSize)));
    volumeBins[binIdx] += c.volume || 1;
  }

  let maxVolIdx = 0;
  let maxVol = 0;
  for (let i = 0; i < bins; i++) {
    if (volumeBins[i] > maxVol) {
      maxVol = volumeBins[i];
      maxVolIdx = i;
    }
  }

  return Number((minPrice + (maxVolIdx + 0.5) * binSize).toFixed(digits));
}

export interface VolumeConfluenceResult {
  scoreBonus: number; // e.g. +1.5 or -0.5
  metrics: VolumeMetrics;
  reasons: string[];
}

/**
 * Evaluates volume confluence for a prospective trade setup.
 */
export function evaluateVolumeConfluence(
  candles: Candle[],
  direction: 'BUY' | 'SELL',
  digits: number = 2
): VolumeConfluenceResult {
  const metrics = calculateRVOL(candles, 20, digits);
  const reasons: string[] = [];
  let scoreBonus = 0;

  if (metrics.rvol >= 2.5) {
    scoreBonus += 1.5;
    reasons.push(`🔥 Climax Institutional Volume (${metrics.rvol}x RVOL): Massive smart money order execution (+1.5)`);
  } else if (metrics.rvol >= 1.5) {
    scoreBonus += 1.0;
    reasons.push(`⚡ High Institutional Participation (${metrics.rvol}x RVOL): Clean order flow follow-through (+1.0)`);
  } else if (metrics.rvol < 0.70) {
    scoreBonus -= 0.5;
    reasons.push(`⚠️ Low Relative Volume (${metrics.rvol}x RVOL): Sub-baseline liquidity, retail chop risk (-0.5)`);
  }

  if (metrics.volumeType === 'DISPLACEMENT') {
    scoreBonus += 0.5;
    reasons.push('Institutional Displacement: Expansion body confirms aggressive smart money positioning (+0.5)');
  } else if (metrics.volumeType === 'ABSORPTION') {
    scoreBonus += 0.5;
    reasons.push('Institutional Absorption: High-volume rejection wick shows limit orders soaking up counter-liquidity (+0.5)');
  }

  // Relative CVD alignment check (works on both low-tick FX brokers and high-volume metals)
  const totalVol20 = Math.max(1, candles.slice(-20).reduce((sum, c) => sum + (c.volume || 1), 0));
  const cvdRatio = Math.abs(metrics.cvdDelta) / totalVol20;
  const cvdAligned = (direction === 'BUY' && metrics.cvdDelta > 0) || (direction === 'SELL' && metrics.cvdDelta < 0);
  if (cvdAligned && (cvdRatio >= 0.12 || Math.abs(metrics.cvdDelta) > 500)) {
    scoreBonus += 0.25;
    reasons.push(`Cumulative Volume Delta (${metrics.cvdDelta > 0 ? '+' : ''}${metrics.cvdDelta}, ${(cvdRatio * 100).toFixed(0)}% net bias) aligns with ${direction} momentum (+0.25)`);
  }

  return {
    scoreBonus: Number(scoreBonus.toFixed(2)),
    metrics,
    reasons,
  };
}
