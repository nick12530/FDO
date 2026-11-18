/**
 * smcCore.ts - Broker-data SMC + TA candidate engine for FX and XAU
 * Direct TypeScript implementation of smc_core.py
 * Design goals: lookahead-safe, high fidelity, confluence scoring.
 */

import {
  Candle,
  Swing,
  StructureEvent,
  Zone,
  DealingRange,
  SessionInfo,
  Signal,
  LiquiditySweepInfo,
  VolumeMetrics,
  EconomicEvent,
  MultiFactorConfluenceBreakdown,
} from '../types/smc';
import { analyzeCandlestickPatterns } from './candlestickPatterns';
import { evaluateVolumeConfluence } from './volumeEngine';
import { evaluateMacroSurpriseConfluence } from './macroSurpriseEngine';
import { newsSentimentEngine } from './newsSentimentEngine';
import { intermarketEngine } from './intermarketEngine';
import { getInstrumentConfig, type SupportedSymbol } from './instrumentConfig';
import { normalizeRawStrategyScore, SIGNAL_SCORING_POLICY_VERSION } from './scorePolicy';

// ============================================================
// 1. INDICATORS: Wilder's ATR
// ============================================================
export function calculateATR(candles: Candle[], n: number = 14): number[] {
  const len = candles.length;
  const out = new Array<number>(len).fill(NaN);
  if (len < n || !Number.isInteger(n) || n < 1) return out;

  const tr: number[] = new Array(len);
  tr[0] = candles[0].high - candles[0].low;

  for (let i = 1; i < len; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const prevC = candles[i - 1].close;
    tr[i] = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
  }

  // Seed Wilder's smoothing with n true-range observations.
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += tr[i];
  }
  out[n - 1] = sum / n;

  // Wilder recursive smoothing
  for (let i = n; i < len; i++) {
    out[i] = (out[i - 1] * (n - 1) + tr[i]) / n;
  }

  return out;
}

// ============================================================
// 2. MARKET STRUCTURE: Swings -> BOS / CHoCH
// ============================================================
export class MarketStructureEngine {
  k: number;
  swings: Swing[] = [];
  events: StructureEvent[] = [];
  trend: 'bullish' | 'bearish' | 'ranging' = 'ranging';
  lastSwingHigh: Swing | null = null;
  lastSwingLow: Swing | null = null;

  constructor(k: number = 3) {
    this.k = k;
  }

  update(candles: Candle[]): void {
    const n = candles.length;
    const k = this.k;
    const confirmed: Swing[] = [];
    let currentTrend: 'bullish' | 'bearish' | 'ranging' = 'ranging';
    const newEvents: StructureEvent[] = [];
    let lastH: Swing | null = null;
    let lastL: Swing | null = null;
    let activeHighBroken = false;
    let activeLowBroken = false;

    // Process pivots and breaks in bar order so event classification cannot use future events.
    for (let bar = 0; bar < n; bar += 1) {
      const pivotIndex = bar - k;
      if (pivotIndex >= k) {
        let isHigh = true;
        let isLow = true;
        for (let index = pivotIndex - k; index <= pivotIndex + k; index += 1) {
          if (candles[index].high > candles[pivotIndex].high) isHigh = false;
          if (candles[index].low < candles[pivotIndex].low) isLow = false;
          if (!isHigh && !isLow) break;
        }

        if (isHigh) {
          const swing = { idx: pivotIndex, price: candles[pivotIndex].high, kind: 'H' as const, time: candles[pivotIndex].time };
          confirmed.push(swing);
          lastH = swing;
          activeHighBroken = false;
        } else if (isLow) {
          const swing = { idx: pivotIndex, price: candles[pivotIndex].low, kind: 'L' as const, time: candles[pivotIndex].time };
          confirmed.push(swing);
          lastL = swing;
          activeLowBroken = false;
        }
      }

      const candle = candles[bar];
      if (lastH && !activeHighBroken && candle.close > lastH.price) {
        newEvents.push({
          kind: currentTrend === 'bearish' ? 'CHoCH' : 'BOS',
          direction: 'bullish',
          price: lastH.price,
          bar,
          time: candle.time,
        });
        currentTrend = 'bullish';
        activeHighBroken = true;
      }
      if (lastL && !activeLowBroken && candle.close < lastL.price) {
        newEvents.push({
          kind: currentTrend === 'bullish' ? 'CHoCH' : 'BOS',
          direction: 'bearish',
          price: lastL.price,
          bar,
          time: candle.time,
        });
        currentTrend = 'bearish';
        activeLowBroken = true;
      }
    }

    this.swings = confirmed;
    this.events = newEvents;
    this.trend = currentTrend;
    this.lastSwingHigh = lastH;
    this.lastSwingLow = lastL;
  }

  dealingRange(): DealingRange | null {
    if (this.lastSwingHigh && this.lastSwingLow) {
      const lo = this.lastSwingLow.price;
      const hi = this.lastSwingHigh.price;
      return {
        low: lo,
        high: hi,
        equilibrium: (hi + lo) / 2,
      };
    }
    return null;
  }
}

// ============================================================
// 3. ZONES: Fair Value Gaps & Order Blocks with Mitigation
// ============================================================
function markMitigation(zones: Zone[], candles: Candle[]): void {
  for (const z of zones) {
    let tests = 0;
    let filled = false;

    for (let i = z.born + 1; i < candles.length; i++) {
      const c = candles[i];
      if (z.bullish) {
        if (c.low <= z.top) tests++;
        if (c.low <= z.bottom) {
          filled = true;
        }
      } else {
        if (c.high >= z.bottom) tests++;
        if (c.high >= z.top) {
          filled = true;
        }
      }
    }

    z.tests = tests;
    z.filled = filled;
  }
}

export function detectFVGs(candles: Candle[], atrArr: number[], minMult: number = 0.15): Zone[] {
  const zones: Zone[] = [];
  const n = candles.length;

  for (let i = 2; i < n; i++) {
    const atrNow = atrArr[i];
    if (isNaN(atrNow) || atrNow <= 0) continue;

    const gapUp = candles[i].low - candles[i - 2].high; // Bullish FVG
    const gapDn = candles[i - 2].low - candles[i].high; // Bearish FVG

    if (gapUp > minMult * atrNow) {
      zones.push({
        kind: 'FVG',
        top: candles[i].low,
        bottom: candles[i - 2].high,
        bullish: true,
        born: i,
        bornTime: candles[i].time,
        filled: false,
        tests: 0,
      });
    }

    if (gapDn > minMult * atrNow) {
      zones.push({
        kind: 'FVG',
        top: candles[i - 2].low,
        bottom: candles[i].high,
        bullish: false,
        born: i,
        bornTime: candles[i].time,
        filled: false,
        tests: 0,
      });
    }
  }

  markMitigation(zones, candles);
  return zones;
}

export function detectOrderBlocks(
  candles: Candle[],
  _atrArr: number[],
  impulseMult: number = 1.5,
  minBodyFrac: number = 0.4
): Zone[] {
  const n = candles.length;
  const zones: Zone[] = [];
  const used = new Set<number>();

  // Calculate 20-period rolling average body
  const bodySizes: number[] = new Array(n);
  const avgBodies: number[] = new Array(n).fill(NaN);

  for (let i = 0; i < n; i++) {
    bodySizes[i] = Math.abs(candles[i].close - candles[i].open);
    if (i >= 19) {
      let sum = 0;
      for (let k = i - 19; k <= i; k++) {
        sum += bodySizes[k];
      }
      avgBodies[i] = sum / 20;
    }
  }

  for (let i = 21; i < n; i++) {
    const avgBody = avgBodies[i];
    if (isNaN(avgBody) || used.has(i)) continue;

    const body = bodySizes[i];
    const range = candles[i].high - candles[i].low + 1e-12;
    const isImpulse = body > impulseMult * avgBody && body / range > minBodyFrac;

    if (!isImpulse) continue;

    const j = i - 1;
    const curr = candles[i];
    const prev = candles[j];

    if (curr.close > curr.open && prev.close < prev.open) {
      // Bullish impulse -> Demand OB (previous bearish candle)
      zones.push({
        kind: 'OB',
        top: prev.high,
        bottom: prev.low,
        bullish: true,
        born: j,
        bornTime: prev.time,
        filled: false,
        tests: 0,
      });
      used.add(j);
    } else if (curr.close < curr.open && prev.close > prev.open) {
      // Bearish impulse -> Supply OB (previous bullish candle)
      zones.push({
        kind: 'OB',
        top: prev.high,
        bottom: prev.low,
        bullish: false,
        born: j,
        bornTime: prev.time,
        filled: false,
        tests: 0,
      });
      used.add(j);
    }
  }

  markMitigation(zones, candles);
  return zones;
}

// ============================================================
// 4. SESSION FILTER (London and New York sessions for XAUUSD)
// ============================================================
export function sessionFilter(dateOrTimestamp: Date | number): SessionInfo {
  const d = typeof dateOrTimestamp === 'number' ? new Date(dateOrTimestamp) : dateOrTimestamp;
  const utcHours = d.getUTCHours();
  const utcMinutes = d.getUTCMinutes();
  const localMinutes = (timeZone: string) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value);
    return hour * 60 + minute;
  };
  const londonTime = localMinutes('Europe/London');
  const newYorkTime = localMinutes('America/New_York');
  const tokyoTime = localMinutes('Asia/Tokyo');
  const sydneyTime = localMinutes('Australia/Sydney');

  const london = londonTime >= 480 && londonTime <= 1020;
  const londonKillZone = londonTime >= 480 && londonTime <= 660;
  const newYork = newYorkTime >= 480 && newYorkTime <= 1020;
  const newYorkKillZone = newYorkTime >= 480 && newYorkTime <= 720;
  const asian = tokyoTime >= 0 && tokyoTime <= 540;
  const sydney = sydneyTime >= 420 && sydneyTime <= 960;

  const tradable = london || newYork;

  let activeSessionName = 'Asian Session';
  if (london && newYork) activeSessionName = 'London / NY Overlap';
  else if (londonKillZone) activeSessionName = 'London Kill Zone';
  else if (newYorkKillZone) activeSessionName = 'New York Kill Zone';
  else if (london) activeSessionName = 'London Session';
  else if (newYork) activeSessionName = 'New York Session';
  else if (asian) activeSessionName = 'Tokyo / Asian Session';
  else if (sydney) activeSessionName = 'Sydney Session';

  const pad = (n: number) => n.toString().padStart(2, '0');
  const currentUtcTime = `${pad(utcHours)}:${pad(utcMinutes)}:${pad(d.getUTCSeconds())} UTC`;
  // East Africa Time (EAT = UTC + 3)
  const eatHours = (utcHours + 3) % 24;
  const currentEatTime = `${pad(eatHours)}:${pad(utcMinutes)}:${pad(d.getUTCSeconds())} EAT`;

  // High-activity session windows
  // London Open: 07:00 – 10:00 UTC (10:00 – 13:00 EAT)
  const londonOpenWindow = utcHours >= 7 && utcHours < 10;
  // New York AM / Silver Bullet: 13:00 – 16:00 UTC (16:00 – 19:00 EAT)
  const newYorkSilverBullet = utcHours >= 13 && utcHours < 16;
  // Low-liquidity Asian Consolidation: 21:00 – 05:00 UTC (00:00 – 08:00 EAT)
  const asianConsolidation = utcHours >= 21 || utcHours < 5;
  const isHighVolumeWindow = londonOpenWindow || newYorkSilverBullet;

  const sessions = [
    { id: 'london' as const, name: 'London', active: london, hours: '08:00–17:00 London local (11:00–20:00 EAT)' },
    { id: 'new_york' as const, name: 'New York', active: newYork, hours: '08:00–17:00 New York local (16:00–01:00 EAT)' },
    { id: 'asian' as const, name: 'Asian / Tokyo', active: asian, hours: '00:00–09:00 Tokyo local (00:00–09:00 EAT)' },
    { id: 'sydney' as const, name: 'Sydney', active: sydney, hours: '07:00–16:00 Sydney local (00:00–09:00 EAT)' },
  ];

  return {
    london,
    new_york: newYork,
    asian,
    sydney,
    tradable,
    currentUtcTime,
    currentEatTime,
    activeSessionName,
    londonOpenWindow,
    newYorkSilverBullet,
    asianConsolidation,
    isHighVolumeWindow,
    sessions,
  };
}

/**
 * Liquidity Sweep / Swing Failure Pattern (SFP) Gate Engine
 * Checks whether the current/recent candle wicked past previous swing highs/lows
 * or Asian session extremes to collect liquidity, then rejected back inside the range.
 */
export function detectLiquiditySweep(
  candles: Candle[],
  swings: Swing[],
  direction: 'BUY' | 'SELL',
  lookbackBars: number = 3,
  digits: number = 2
): LiquiditySweepInfo {
  if (candles.length < 5) return { hasSweep: false };
  const lastIdx = candles.length - 1;
  const lastCandle = candles[lastIdx];
  const maxCheck = Math.min(Math.max(1, lookbackBars), Math.max(1, candles.length - 4));

  for (let offset = 0; offset < maxCheck; offset++) {
    const sweepIdx = lastIdx - offset;
    const sweepCandle = candles[sweepIdx];
    const priorCandles = candles.slice(Math.max(0, sweepIdx - 11), sweepIdx);
    if (priorCandles.length === 0) continue;

    if (direction === 'SELL') {
      const priorHighs = swings.filter((s) => s.kind === 'H' && s.idx < sweepIdx).slice(-6);
      const targetHigh = priorHighs.length > 0
        ? Math.max(...priorHighs.map((h) => h.price))
        : Math.max(...priorCandles.map((c) => c.high));

      const swept = sweepCandle.high > targetHigh && lastCandle.close < targetHigh;
      const multiBarConfirmed =
        offset === 0 || (lastCandle.close < lastCandle.open && lastCandle.close < sweepCandle.high);

      if (swept && multiBarConfirmed) {
        const barLabel = offset === 0 ? 'SFP' : `${offset + 1}-Bar Sweep`;
        return {
          hasSweep: true,
          type: 'SWING_HIGH_SFP',
          sweptPrice: targetHigh,
          rejectionConfirmed: true,
          description: `Bearish Liquidity Sweep / ${barLabel}: Wick pierced above ${targetHigh.toFixed(digits)} taking buy-side liquidity, rejected back into range (Close: ${lastCandle.close.toFixed(digits)}).`,
        };
      }
    } else {
      const priorLows = swings.filter((s) => s.kind === 'L' && s.idx < sweepIdx).slice(-6);
      const targetLow = priorLows.length > 0
        ? Math.min(...priorLows.map((l) => l.price))
        : Math.min(...priorCandles.map((c) => c.low));

      const swept = sweepCandle.low < targetLow && lastCandle.close > targetLow;
      const multiBarConfirmed =
        offset === 0 || (lastCandle.close > lastCandle.open && lastCandle.close > sweepCandle.low);

      if (swept && multiBarConfirmed) {
        const barLabel = offset === 0 ? 'SFP' : `${offset + 1}-Bar Sweep`;
        return {
          hasSweep: true,
          type: 'SWING_LOW_SFP',
          sweptPrice: targetLow,
          rejectionConfirmed: true,
          description: `Bullish Liquidity Sweep / ${barLabel}: Wick pierced below ${targetLow.toFixed(digits)} taking sell-side liquidity, rejected back into range (Close: ${lastCandle.close.toFixed(digits)}).`,
        };
      }
    }
  }

  return { hasSweep: false };
}

export function evaluateMarketRegime(
  candles: Candle[],
  atrArr: number[]
): { regime: 'TRENDING' | 'EXPANSION' | 'CHOP' | 'LOW_VOL'; efficiencyRatio: number; atrRatio: number } {
  const period = 10;
  if (candles.length <= period) {
    return { regime: 'TRENDING', efficiencyRatio: 0.5, atrRatio: 1.0 };
  }

  const slice = candles.slice(-(period + 1));
  const netMove = Math.abs(slice[slice.length - 1].close - slice[0].close);
  let totalPath = 0;
  for (let i = 1; i < slice.length; i++) {
    totalPath += Math.abs(slice[i].close - slice[i - 1].close);
  }
  const efficiencyRatio = totalPath > 0 ? netMove / totalPath : 0;

  const validAtrs = atrArr.slice(-20).filter((v) => Number.isFinite(v) && v > 0);
  const atrNow = validAtrs.length > 0 ? validAtrs[validAtrs.length - 1] : 0;
  const avgAtr = validAtrs.length > 0 ? validAtrs.reduce((s, v) => s + v, 0) / validAtrs.length : atrNow;
  const atrRatio = avgAtr > 0 ? atrNow / avgAtr : 1.0;

  let regime: 'TRENDING' | 'EXPANSION' | 'CHOP' | 'LOW_VOL' = 'TRENDING';
  if (atrRatio >= 1.35 && efficiencyRatio >= 0.32) {
    regime = 'EXPANSION';
  } else if (atrRatio < 0.72 && efficiencyRatio < 0.22) {
    regime = 'LOW_VOL';
  } else if (efficiencyRatio < 0.20) {
    regime = 'CHOP';
  }

  return {
    regime,
    efficiencyRatio: Number(efficiencyRatio.toFixed(2)),
    atrRatio: Number(atrRatio.toFixed(2)),
  };
}

export function hasRecentCandleGap(candles: Candle[], intervalMs: number, lookback: number = 4): boolean {
  const recent = candles.slice(-lookback);
  return recent.some(
    (candle, index) => index > 0 && candle.time - recent[index - 1].time > intervalMs * 2
  );
}

// ============================================================
// 5. SIGNAL FUSION - Weighted Confluence Scoring
// ============================================================
export function evaluateConfluence(
  dfExec: Candle[],
  dfHtf: Candle[],
  rr: number = 2.0,
  minScorePercentThreshold: number = 45,
  timeframe: 'M1' | 'M5' | 'M15' = 'M5',
  context?: {
    symbol?: SupportedSymbol;
    economicEvents?: EconomicEvent[];
  }
): Signal | null {
  if (dfExec.length < 26 || dfHtf.length < 21) return null;

  // Broker snapshots provide completed bars only; consume the latest one without dropping it twice.
  const closed = dfExec;
  const closedHtf = dfHtf;

  const aExec = calculateATR(closed);
  const lastCandle = closed[closed.length - 1];
  const price = lastCandle.close;
  const atrNow = aExec[aExec.length - 1];

  if (isNaN(atrNow) || atrNow <= 0) return null;
  const now = Date.now();
  const toMilliseconds = (time: number) => (time < 1_000_000_000_000 ? time * 1000 : time);
  const timeframeMs = { M1: 60_000, M5: 5 * 60_000, M15: 15 * 60_000 }[timeframe];
  const htfTimeframeMs = timeframe === 'M1' ? 5 * 60_000 : timeframe === 'M5' ? 15 * 60_000 : 60 * 60_000;
  if (
    now - toMilliseconds(lastCandle.time) > timeframeMs * 3 ||
    now - toMilliseconds(dfHtf[dfHtf.length - 1].time) > htfTimeframeMs * 3 ||
    hasRecentCandleGap(dfExec, timeframeMs) ||
    hasRecentCandleGap(dfHtf, htfTimeframeMs)
  ) {
    return null;
  }

  // Dual-Speed Structure: Macro swing structure (k=3) on HTF
  const ms = new MarketStructureEngine(3);
  ms.update(closedHtf);

  // Micro internal structure (k=1) on execution timeframe for immediate reaction at POI
  const internalMs = new MarketStructureEngine(1);
  internalMs.update(closed);

  // Unmitigated recent zones from execution timeframe (analyzed on closed candles)
  const fvgs = detectFVGs(closed, aExec).filter((z) => !z.filled).slice(-8);
  const obs = detectOrderBlocks(closed, aExec).filter((z) => !z.filled).slice(-8);
  const zones = [...fvgs, ...obs];

  const sess = sessionFilter(lastCandle.time);

  let score = 0.0;
  const reasons: string[] = [];

  if (ms.trend === 'ranging') return null;

  score += 2.0;
  reasons.push(`HTF ${ms.trend.toUpperCase()} structure aligned (+2.0)`);

  const dr = ms.dealingRange();
  let inDiscount = false;
  let inPremium = false;
  let inOteZone = false;

  if (dr) {
    inDiscount = price < dr.equilibrium;
    inPremium = price > dr.equilibrium;
    const delta = dr.high - dr.low;
    if (delta > 0) {
      if (ms.trend === 'bullish') {
        const ote62 = dr.high - 0.618 * delta;
        const ote79 = dr.high - 0.786 * delta;
        inOteZone = price <= ote62 && price >= ote79;
      } else if (ms.trend === 'bearish') {
        const ote62 = dr.low + 0.618 * delta;
        const ote79 = dr.low + 0.786 * delta;
        inOteZone = price >= ote62 && price <= ote79;
      }
    }
  }

  const cfg = context?.symbol ? getInstrumentConfig(context.symbol) : null;
  const pipSize = cfg ? cfg.pipSize : (price > 500 ? 0.1 : price > 20 ? 0.01 : 0.0001);
  const digits = cfg ? cfg.digits : (price > 500 ? 2 : price > 20 ? 3 : 5);
  const symbolLabel = context?.symbol || (price > 500 ? 'Gold' : 'Market');
  const fmt = (value: number) => value.toFixed(digits);
  const pricePrefix = price > 500 ? '$' : '';

  let direction: 'BUY' | 'SELL' | null = null;
  let zone: Zone | null = null;

  const pickBestZone = (bullish: boolean): Zone | null => {
    const candidates = zones.filter(
      (z) => z.bullish === bullish && z.tests <= 2 && z.bottom - 0.25 * atrNow <= price && price <= z.top + 0.25 * atrNow
    );
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      if (a.tests !== b.tests) return a.tests - b.tests;
      const distA = Math.abs((a.top + a.bottom) / 2 - price);
      const distB = Math.abs((b.top + b.bottom) / 2 - price);
      return distA - distB;
    });
    return candidates[0];
  };

  if (ms.trend === 'bullish' && inDiscount) {
    score += 1.0;
    reasons.push('Price in DISCOUNT of HTF dealing range (< Equilibrium) (+1.0)');
    if (inOteZone) {
      score += 1.0;
      reasons.push('⭐ Price in Fibonacci OTE zone (61.8% – 78.6%) (+1.0)');
    }
    zone = pickBestZone(true);
  } else if (ms.trend === 'bearish' && inPremium) {
    score += 1.0;
    reasons.push('Price in PREMIUM of HTF dealing range (> Equilibrium) (+1.0)');
    if (inOteZone) {
      score += 1.0;
      reasons.push('⭐ Price in Fibonacci OTE zone (61.8% – 78.6%) (+1.0)');
    }
    zone = pickBestZone(false);
  }

  let sl = 0;
  let tp = 0;
  let tp1 = 0;
  let tp2 = 0;
  let tp3 = 0;

  const minRequiredRR = timeframe === 'M1' ? 1.2 : timeframe === 'M5' ? 1.5 : 2.0;

  if (zone) {
    direction = zone.bullish ? 'BUY' : 'SELL';
    score += 1.5;
    reasons.push(
      `${zone.kind} retest (${zone.bullish ? 'Demand' : 'Supply'}, ${zone.tests} prior test${zone.tests === 1 ? '' : 's'}) (+1.5)`
    );

    // Fresh POI confluence bonus
    if (zone.tests === 0) {
      score += 0.5;
      reasons.push('Fresh, unmitigated point of interest (+0.5)');
    }

    const base = zone.bullish ? zone.bottom : zone.top;
    const buf = 0.5 * atrNow;
    sl = direction === 'BUY' ? base - buf : base + buf;

    let risk = Math.abs(price - sl);
    if (risk < 0.5 * atrNow) {
      // SL sanity: must be beyond noise
      sl = direction === 'BUY' ? price - atrNow : price + atrNow;
      risk = atrNow;
      reasons.push('SL buffered to 1.0x ATR beyond market noise');
    }

    // Timeframe-calibrated target ladder for M1/M5 scalping vs M15 swings
    const mult1 = timeframe === 'M1' ? 1.2 : timeframe === 'M5' ? 1.5 : Math.max(1.8, Number((rr * 0.9).toFixed(1)));
    const mult2 = timeframe === 'M1' ? 2.0 : timeframe === 'M5' ? 2.5 : Math.max(3.2, Number((rr * 1.6).toFixed(1)));
    const mult3 = timeframe === 'M1' ? 3.2 : timeframe === 'M5' ? 4.0 : Math.max(5.5, Number((rr * 2.8).toFixed(1)));
    tp1 = direction === 'BUY' ? price + mult1 * risk : price - mult1 * risk;
    tp2 = direction === 'BUY' ? price + mult2 * risk : price - mult2 * risk;
    tp3 = direction === 'BUY' ? price + mult3 * risk : price - mult3 * risk;
    tp = tp2;
  } else {
    return null;
  }

  if (ms.events.length > 0) {
    const lastEvent = ms.events[ms.events.length - 1];
    if (lastEvent.direction === (direction === 'BUY' ? 'bullish' : 'bearish')) {
      score += 1.0;
      reasons.push(`Last structure event ${lastEvent.kind} (${lastEvent.direction}) aligned (+1.0)`);
    }
  }

  // Micro internal structure confirmation at POI
  if (internalMs.events.length > 0) {
    const recentInternal = internalMs.events.filter((e) => closed.length - 1 - e.bar <= 6);
    const lastInternal = recentInternal[recentInternal.length - 1];
    if (lastInternal && lastInternal.direction === (direction === 'BUY' ? 'bullish' : 'bearish')) {
      score += 1.0;
      reasons.push(`Micro internal ${lastInternal.kind} (${lastInternal.direction}) confirms displacement at POI (+1.0)`);
    }
  }

  // Liquidity Sweep / Swing Failure Pattern (SFP) Gate Engine (3-bar lookback on closed candles)
  const sweep = detectLiquiditySweep(closed, ms.swings, direction, 3, digits);
  if (sweep.hasSweep) {
    score += 1.5;
    reasons.push(`${sweep.description} (+1.5)`);

    // Tighten SL to the swept wick invalidation level for precision sniper entry
    if (sweep.sweptPrice) {
      const sniperSl = direction === 'BUY'
        ? Number((sweep.sweptPrice - 0.2 * atrNow).toFixed(digits))
        : Number((sweep.sweptPrice + 0.2 * atrNow).toFixed(digits));
      if (Math.abs(price - sniperSl) < Math.abs(price - sl)) {
        sl = sniperSl;
        reasons.push(`🎯 Sniper Stop Loss calibrated strictly to swept liquidity wick (${pricePrefix}${fmt(sweep.sweptPrice)})`);
      }
    }
  }

  // Market Regime Filter (detects low-efficiency chop vs clean displacement expansion)
  const regimeInfo = evaluateMarketRegime(closed, aExec);
  if (regimeInfo.regime === 'CHOP' && !sweep.hasSweep) {
    score -= 0.5;
    reasons.push(`⚠️ Choppy Regime (ER ${regimeInfo.efficiencyRatio}): Sub-optimal trend efficiency without sweep (-0.5)`);
  } else if (regimeInfo.regime === 'EXPANSION') {
    score += 0.25;
    reasons.push(`⚡ Expansion Regime (ATR ${regimeInfo.atrRatio}x, ER ${regimeInfo.efficiencyRatio}) favors follow-through (+0.25)`);
  }

  if (!sess.tradable) return null;
  score += 0.5;
  reasons.push(`Inside active ${sess.activeSessionName} (+0.5)`);

  // Asian session consolidation suppression (21:00 - 05:00 UTC / 00:00 - 08:00 EAT)
  const inAsianConsolidation = Boolean(sess.asianConsolidation);
  const isHighProfitException = score >= 6.5;
  if (inAsianConsolidation && !isHighProfitException) {
    return null;
  }
  if (inAsianConsolidation && isHighProfitException) {
    reasons.push('⭐ High-confluence exception: setup allowed during Asian consolidation');
  }

  // Instrument-neutral Candlestick Pattern Engine (pip-scaled for FX + XAUUSD)
  const csAnalysis = analyzeCandlestickPatterns(closed, pipSize, symbolLabel);
  const activePattern = csAnalysis.activePattern;
  const targetBias = direction === 'BUY' ? 'BULLISH' : 'BEARISH';
  if (activePattern.bias !== targetBias || activePattern.reliability < 80) return null;
  score += (activePattern.reliability / 100) * 0.75;
  reasons.push(`${activePattern.name} (${activePattern.wickRatio}, pattern score ${activePattern.reliability}/100) (+${((activePattern.reliability / 100) * 0.75).toFixed(2)})`);

  // Determine the triggering candle pattern and mechanics
  const isBear = direction === 'SELL';
  const range = Math.max(pipSize * 0.1, lastCandle.high - lastCandle.low);
  const upperWick = lastCandle.high - Math.max(lastCandle.open, lastCandle.close);
  const lowerWick = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;
  const body = Math.abs(lastCandle.close - lastCandle.open);
  const prevCandle = closed.length >= 2 ? closed[closed.length - 2] : lastCandle;

  // Dual-Track Trigger: Absorption Wick (Rejection) OR Displacement Body (Expansion / Engulfing)
  const isAbsorptionWick = direction === 'BUY'
    ? (lowerWick >= 0.40 * range) || (lastCandle.close > lastCandle.open && lowerWick >= body * 0.8)
    : (upperWick >= 0.40 * range) || (lastCandle.close < lastCandle.open && upperWick >= body * 0.8);

  const isDisplacementBody = direction === 'BUY'
    ? lastCandle.close > lastCandle.open && (body >= 0.50 * range || lastCandle.close > prevCandle.high)
    : lastCandle.close < lastCandle.open && (body >= 0.50 * range || lastCandle.close < prevCandle.low);

  // 1. Broker tick-volume proxy confluence; this does not establish institutional order flow.
  const volResult = evaluateVolumeConfluence(closed, direction, digits);
  const smcBaseScore = score;
  score += volResult.scoreBonus;
  reasons.push(...volResult.reasons);

  // 2. Macroeconomic Calendar Surprises (CPI, NFP, GDP, Rate Decisions)
  let macroBonus = 0;
  if (context?.symbol && context?.economicEvents) {
    const macroResult = evaluateMacroSurpriseConfluence(context.symbol, direction, context.economicEvents);
    macroBonus = macroResult.scoreBonus;
    score += macroResult.scoreBonus;
    reasons.push(...macroResult.reasons);
  }

  // 3. News headline sentiment
  let sentimentBonus = 0;
  if (context?.symbol) {
    const sentiment = newsSentimentEngine.evaluatePairSentiment(context.symbol);
    if (
      (direction === 'BUY' && sentiment.sentimentBias === 'BULLISH') ||
      (direction === 'SELL' && sentiment.sentimentBias === 'BEARISH')
    ) {
      sentimentBonus = 0.5;
      score += 0.5;
      reasons.push(`📰 News headline sentiment aligns with ${direction} (+0.5)`);
    } else if (
      (direction === 'BUY' && sentiment.sentimentBias === 'BEARISH') ||
      (direction === 'SELL' && sentiment.sentimentBias === 'BULLISH')
    ) {
      sentimentBonus = -0.5;
      score -= 0.5;
      reasons.push(`⚠️ Headline Sentiment Drag: News leans against ${direction} (-0.5)`);
    }
  }

  // 4. Intermarket Volatility & Correlation Matrix (DXY / Yields / VIX)
  let intermarketBonus = 0;
  if (context?.symbol) {
    const intermarket = intermarketEngine.evaluateConfluence(context.symbol, direction);
    intermarketBonus = intermarket.scoreBonus;
    score += intermarket.scoreBonus;
    reasons.push(...intermarket.reasons);
  }

  const confluenceBreakdown: MultiFactorConfluenceBreakdown = {
    smcStructureScore: Number(smcBaseScore.toFixed(2)),
    volumeRvolScore: Number(volResult.scoreBonus.toFixed(2)),
    macroSurpriseScore: Number(macroBonus.toFixed(2)),
    newsSentimentScore: Number(sentimentBonus.toFixed(2)),
    intermarketScore: Number(intermarketBonus.toFixed(2)),
    totalScore: Number(score.toFixed(2)),
    verdict:
      score >= 6.5
        ? 'PRIME_INSTITUTIONAL'
        : score >= 5.0
        ? 'HIGH_CONFLUENCE'
        : score >= 4.0
        ? 'MODERATE'
        : 'DISQUALIFIED',
    reasons,
  };

  const triggerConfirmed = isAbsorptionWick || isDisplacementBody;
  const normalizedScore = normalizeRawStrategyScore(score);
  if (!triggerConfirmed || normalizedScore < minScorePercentThreshold) return null;
  const wickRatio = isBear
    ? `${((upperWick / range) * 100).toFixed(0)}% Upper Wick`
    : `${((lowerWick / range) * 100).toFixed(0)}% Lower Wick`;

  const patternName = activePattern.name;
  const tf = timeframe;
  const explanation = isBear
    ? `${tf} candle at ${lastCandle.timeStr} reached premium supply at ${pricePrefix}${fmt(lastCandle.high)} and closed lower at ${pricePrefix}${fmt(lastCandle.close)}. ${zone ? `Rejection confirmed off ${zone.kind} Supply (${fmt(zone.bottom)}-${fmt(zone.top)}).` : ''}`
    : `${tf} candle at ${lastCandle.timeStr} reached discount demand at ${pricePrefix}${fmt(lastCandle.low)} and closed higher at ${pricePrefix}${fmt(lastCandle.close)}. ${zone ? `Rejection confirmed off ${zone.kind} Demand (${fmt(zone.bottom)}-${fmt(zone.top)}).` : ''}`;

  const actionReason = isBear
    ? `SELL candidate: ${activePattern.name} reached premium supply (${zone ? `${fmt(zone.bottom)}-${fmt(zone.top)}` : 'POI'}) and shows ${wickRatio}. ${activePattern.marketInsight}`
    : `BUY candidate: ${activePattern.name} reached discount demand (${zone ? `${fmt(zone.bottom)}-${fmt(zone.top)}` : 'POI'}) and shows ${wickRatio}. ${activePattern.marketInsight}`;

  const riskPts = Math.abs(price - sl);
  const rewardPts = Math.abs(tp - price);
  if (riskPts <= 0 || rewardPts / riskPts < minRequiredRR) return null;
  const rrRatio = (rewardPts / Math.max(pipSize * 0.1, riskPts)).toFixed(1);

  const slPips = Number((riskPts / pipSize).toFixed(1));
  const targetPips1 = Number((Math.abs(tp1 - price) / pipSize).toFixed(1));
  const targetPips2 = Number((Math.abs(tp2 - price) / pipSize).toFixed(1));
  const targetPips3 = Number((Math.abs(tp3 - price) / pipSize).toFixed(1));
  const targetPips = targetPips2;

  const perfectEntryReason = isBear
    ? `Perfect Entry identified @ ${pricePrefix}${fmt(price)} on ${tf} confirmation: Tight SL at ${pricePrefix}${fmt(sl)} (${slPips} pips risk) targeting 1:${rrRatio} RR @ ${pricePrefix}${fmt(tp)}.`
    : `Perfect Entry identified @ ${pricePrefix}${fmt(price)} on ${tf} confirmation: Tight SL at ${pricePrefix}${fmt(sl)} (${slPips} pips risk) targeting 1:${rrRatio} RR @ ${pricePrefix}${fmt(tp)}.`;

  const humanExplanation = {
    headline: isBear
      ? `SELL confluence setup on ${symbolLabel}`
      : `BUY confluence setup on ${symbolLabel}`,
    simpleSummary: isBear
      ? `${symbolLabel} reached a premium area and showed bearish price rejection.`
      : `${symbolLabel} reached a discount area and showed bullish price rejection.`,
    marketCondition: isBear
      ? `Higher-timeframe structure is bearish; the latest price action rejected higher levels.`
      : `Higher-timeframe structure is bullish; the latest price action rejected lower levels.`,
    tradeRationale: isBear
      ? `Formed a ${patternName} (${wickRatio}) rejecting supply at ${pricePrefix}${fmt(price)}. Risk is capped just above the swing high.`
      : `Formed a ${patternName} (${wickRatio}) defending demand at ${pricePrefix}${fmt(price)}. Risk is capped just below the swing low.`,
    howToTrade: isBear
      ? `Execute SELL on ${symbolLabel} (${pricePrefix}${fmt(price)}). Stop Loss at ${pricePrefix}${fmt(sl)} (${slPips} pips). Target TP1 ${pricePrefix}${fmt(tp1)} / TP2 ${pricePrefix}${fmt(tp)}.`
      : `Execute BUY on ${symbolLabel} (${pricePrefix}${fmt(price)}). Stop Loss at ${pricePrefix}${fmt(sl)} (${slPips} pips). Target TP1 ${pricePrefix}${fmt(tp1)} / TP2 ${pricePrefix}${fmt(tp)}.`,
    riskRewardSummary: `Risking ${slPips} pips to target ${targetPips} pips (1 : ${rrRatio} Reward-to-Risk).`,
  };

  // Entry countdown timer:
  const validityDurationMs = timeframe === 'M15' ? 15 * 60_000 : timeframe === 'M5' ? 5 * 60_000 : 90_000;
  const candleTimeMs = toMilliseconds(lastCandle.time);
  const expiryTimestamp = candleTimeMs + timeframeMs + validityDurationMs;
  const validitySeconds = Math.max(0, Math.round((expiryTimestamp - now) / 1000));

  // Sniper setup criteria: M15/M5 POI or high-score M1 sweep scalp
  const isSniper =
    timeframe === 'M1'
      ? normalizedScore >= 52 && sweep.hasSweep
      : (timeframe === 'M15' || timeframe === 'M5') &&
        (normalizedScore >= 42 || (sweep.hasSweep && normalizedScore >= 38));
  const sniperQualityIndex = normalizedScore;
  const sniperGrade: 'A+' | 'A' | 'B' = sniperQualityIndex >= 88 ? 'A+' : sniperQualityIndex >= 75 ? 'A' : 'B';

  const rawOte = zone
    ? zone.kind === 'FVG'
      ? (zone.bottom + zone.top) / 2
      : zone.bullish
        ? zone.top
        : zone.bottom
    : sweep.hasSweep && sweep.sweptPrice
    ? direction === 'BUY'
      ? sweep.sweptPrice + 0.62 * (lastCandle.high - sweep.sweptPrice)
      : sweep.sweptPrice - 0.62 * (sweep.sweptPrice - lastCandle.low)
    : price;
  const optimalTradeEntry = Number(rawOte.toFixed(digits));
  const executionMode: Signal['executionMode'] =
    Math.abs(price - optimalTradeEntry) > 0.25 * atrNow ? 'PULLBACK_LIMIT' : 'MARKET';

  const mitigationType = sweep.hasSweep
    ? 'Liquidity Sweep (SFP)'
    : zone
    ? `${zone.kind} (${zone.bullish ? 'Demand' : 'Supply'})`
    : 'Structural POI Retest';
  const generatedAt = new Date().toISOString();
  const sourceCandleOpenTime = toMilliseconds(lastCandle.time);

  return {
    strategy: 'SMC POI Retest',
    direction,
    timeframe,
    score: normalizedScore,
    scoringPolicyVersion: SIGNAL_SCORING_POLICY_VERSION,
    generatedAt,
    availableAt: generatedAt,
    sourceCandleOpenTime,
    sourceCandleCloseTime: sourceCandleOpenTime + timeframeMs,
    entry: Number(price.toFixed(digits)),
    sl: Number(sl.toFixed(digits)),
    tp: Number(tp.toFixed(digits)),
    tp1: Number(tp1.toFixed(digits)),
    tp2: Number(tp2.toFixed(digits)),
    tp3: Number(tp3.toFixed(digits)),
    slPips,
    targetPips1,
    targetPips2,
    targetPips3,
    targetPips,
    expiryTimestamp,
    validitySeconds,
    isSniper,
    sniperQualityIndex,
    sniperGrade,
    optimalTradeEntry,
    executionMode,
    regime: regimeInfo.regime,
    mitigationType,
    reasons,
    atr: Number(atrNow.toFixed(digits)),
    timestamp: new Date(Math.min(toMilliseconds(lastCandle.time), Date.now())).toISOString(),
    actionReason,
    perfectEntryReason,
    candlestickPattern: activePattern,
    humanExplanation,
    liquiditySweep: sweep,
    isOutOfSessionException: inAsianConsolidation && isHighProfitException,
    volumeMetrics: volResult.metrics,
    confluenceBreakdown,
    triggerPattern: {
      name: patternName,
      bias: isBear ? 'bearish' : 'bullish',
      timeframe,
      timeStr: lastCandle.timeStr,
      open: lastCandle.open,
      high: lastCandle.high,
      low: lastCandle.low,
      close: lastCandle.close,
      wickRatio,
      explanation,
    },
  };
}
