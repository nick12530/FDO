/**
 * intermarketEngine.ts - Macro Intermarket Correlation & Volatility Matrix
 *
 * Synthesizes exclusively from live market quotes:
 * - US Dollar Index (DXY) proxy & trend momentum
 * - Realized FX Volatility Regime (CALM, ELEVATED, CRISIS)
 * - Safe-haven vs Risk-On asset rotation
 * - Adaptive stop-loss buffer multipliers
 */

import { IntermarketStatus } from '../types/smc';
import { SupportedSymbol } from './instrumentConfig';

export interface IntermarketConfluenceResult {
  scoreBonus: number;
  status: IntermarketStatus;
  reasons: string[];
}

class IntermarketEngine {
  private status: IntermarketStatus = {
    hasLiveData: false,
    dxyBias: 'neutral',
    dxyChangePct: 0,
    vixLevel: 0,
    vixRegime: 'CALM',
    riskRegime: 'NEUTRAL',
    goldDriver: 'Awaiting live multi-pair quotes',
    recommendedStopBuffer: 1.0,
  };

  /**
   * Updates intermarket status from live 24h percentage changes of core pairs.
   * Resets to uninitialized neutral state if no valid live quotes are supplied.
   */
  public updateQuotes(quotes: Record<string, { bid: number; change24hPct: number }>) {
    const eurusd = quotes['EURUSD'];
    const usdjpy = quotes['USDJPY'];
    const gbpusd = quotes['GBPUSD'];
    const xauusd = quotes['XAUUSD'];

    const changes: number[] = [];
    if (eurusd && Number.isFinite(eurusd.change24hPct) && eurusd.bid > 0) changes.push(Math.abs(eurusd.change24hPct));
    if (gbpusd && Number.isFinite(gbpusd.change24hPct) && gbpusd.bid > 0) changes.push(Math.abs(gbpusd.change24hPct));
    if (usdjpy && Number.isFinite(usdjpy.change24hPct) && usdjpy.bid > 0) changes.push(Math.abs(usdjpy.change24hPct));

    if (changes.length === 0) {
      if (xauusd && Number.isFinite(xauusd.change24hPct) && xauusd.bid > 0) {
        changes.push(Math.abs(xauusd.change24hPct));
      } else {
        this.status = {
          hasLiveData: false,
          dxyBias: 'neutral',
          dxyChangePct: 0,
          vixLevel: 0,
          vixRegime: 'CALM',
          riskRegime: 'NEUTRAL',
          goldDriver: 'Awaiting live multi-pair quotes',
          recommendedStopBuffer: 1.0,
        };
        return;
      }
    }

    // DXY proxy: inverse of EURUSD & GBPUSD, positive with USDJPY
    let dxyScore = 0;
    if (eurusd && eurusd.bid > 0) dxyScore -= eurusd.change24hPct * 0.576;
    if (gbpusd && gbpusd.bid > 0) dxyScore -= gbpusd.change24hPct * 0.119;
    if (usdjpy && usdjpy.bid > 0) dxyScore += usdjpy.change24hPct * 0.136;

    const dxyBias: 'bullish' | 'bearish' | 'neutral' =
      dxyScore >= 0.15 ? 'bullish' : dxyScore <= -0.15 ? 'bearish' : 'neutral';

    const avgChange = changes.reduce((sum, v) => sum + v, 0) / changes.length;
    const realizedVolIndex = Math.max(10, Math.min(40, 12 + avgChange * 12));
    let vixRegime: IntermarketStatus['vixRegime'] = 'CALM';
    let stopBuffer = 1.0;

    if (realizedVolIndex > 28) {
      vixRegime = 'CRISIS';
      stopBuffer = 1.35;
    } else if (realizedVolIndex > 18) {
      vixRegime = 'ELEVATED';
      stopBuffer = 1.15;
    }

    const riskRegime: IntermarketStatus['riskRegime'] =
      dxyBias === 'bullish' || vixRegime !== 'CALM'
        ? 'RISK_OFF'
        : dxyBias === 'bearish'
          ? 'RISK_ON'
          : 'NEUTRAL';

    this.status = {
      hasLiveData: true,
      dxyBias,
      dxyChangePct: Number(dxyScore.toFixed(2)),
      vixLevel: Number(realizedVolIndex.toFixed(1)),
      vixRegime,
      riskRegime,
      goldDriver:
        riskRegime === 'RISK_OFF'
          ? 'Dollar Strength & Defensive Volatility Positioning'
          : riskRegime === 'RISK_ON'
            ? 'Softening USD Liquidity & Yield Flows'
            : 'Balanced Cross-Asset Session Flow',
      recommendedStopBuffer: stopBuffer,
    };
  }

  public getStatus(): IntermarketStatus {
    return { ...this.status };
  }

  /**
   * Evaluates intermarket alignment for a proposed trade direction.
   */
  public evaluateConfluence(
    symbol: SupportedSymbol,
    direction: 'BUY' | 'SELL'
  ): IntermarketConfluenceResult {
    const s = this.status;
    if (!s.hasLiveData) {
      return {
        scoreBonus: 0,
        status: s,
        reasons: [],
      };
    }

    let scoreBonus = 0;
    const reasons: string[] = [];

    const isDollarWeak = s.dxyBias === 'bearish';
    const isDollarStrong = s.dxyBias === 'bullish';

    if (symbol === 'EURUSD' || symbol === 'GBPUSD') {
      if ((direction === 'BUY' && isDollarWeak) || (direction === 'SELL' && isDollarStrong)) {
        scoreBonus += 0.5;
        reasons.push(`Intermarket: DXY Dollar proxy bias (${s.dxyBias.toUpperCase()}) aligns with ${direction} (+0.5)`);
      } else if ((direction === 'BUY' && isDollarStrong) || (direction === 'SELL' && isDollarWeak)) {
        scoreBonus -= 0.5;
        reasons.push(`Intermarket warning: DXY Dollar proxy (${s.dxyBias.toUpperCase()}) creates counter-currency drag (-0.5)`);
      }
    } else if (symbol === 'USDJPY') {
      if ((direction === 'BUY' && isDollarStrong) || (direction === 'SELL' && isDollarWeak)) {
        scoreBonus += 0.5;
        reasons.push(`Intermarket: DXY Dollar strength aligns with USDJPY ${direction} (+0.5)`);
      }
    } else if (symbol === 'XAUUSD') {
      if (direction === 'BUY' && (s.riskRegime === 'RISK_OFF' || isDollarWeak)) {
        scoreBonus += 0.75;
        reasons.push(`Intermarket: ${s.goldDriver} provides tailwind for Gold BUY (+0.75)`);
      } else if (direction === 'SELL' && isDollarStrong && s.riskRegime === 'RISK_ON') {
        scoreBonus += 0.5;
        reasons.push(`Intermarket: Risk-On appetite and Dollar strength support Gold SELL (+0.5)`);
      }
    }

    if (s.vixRegime === 'ELEVATED') {
      reasons.push(`Macro Volatility: Vol index elevated (${s.vixLevel}); SL buffer scaled to ${s.recommendedStopBuffer}x ATR`);
    } else if (s.vixRegime === 'CRISIS') {
      reasons.push(`Market Volatility Shock: Vol index in Crisis regime (${s.vixLevel}); strict confirmation enforced`);
    }

    return {
      scoreBonus: Number(scoreBonus.toFixed(2)),
      status: s,
      reasons,
    };
  }
}

export const intermarketEngine = new IntermarketEngine();
