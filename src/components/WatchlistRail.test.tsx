import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { getScannerCardStatus, WatchlistRail } from './WatchlistRail';
import type { PairAnalysis } from '../engine/multiPairScanner';
import { SUPPORTED_SYMBOLS } from '../engine/instrumentConfig';
import { tradingEngine } from '../engine/tradingEngine';

const hookState = vi.hoisted(() => ({
  engine: { autoSelectBestScenario: true, mt5Account: { connected: true } },
  ticker: { symbol: 'XAUUSD', quoteUpdatedAt: Date.now(), marketDataAvailable: true },
  webhook: { hasValidDestination: false },
}));

vi.mock('../hooks/useTradingStore', () => ({
  useEngine: () => hookState.engine,
  useTicker: () => hookState.ticker,
  useWebhookState: () => hookState.webhook,
}));

describe('WatchlistRail', () => {
  it('keeps cards compact and separates chart selection from opening details', () => {
    tradingEngine.stopEngineLoops();
    const onSelectSymbol = vi.fn();

    render(
      <WatchlistRail
        scannerAnalyses={[]}
        activeSymbol="XAUUSD"
        onSelectSymbol={onSelectSymbol}
      />
    );

    expect(screen.getAllByLabelText('WAITING status')).toHaveLength(SUPPORTED_SYMBOLS.length);
    expect(screen.getAllByText(/Spread Unavailable/)).toHaveLength(SUPPORTED_SYMBOLS.length);
    expect(screen.queryByText('Market Structure')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open XAUUSD details' }));

    expect(screen.getByRole('region', { name: 'XAUUSD trade details' })).toBeTruthy();
    expect(screen.getByText(/Broker analysis for XAUUSD is unavailable/)).toBeTruthy();
    expect(onSelectSymbol).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Select for chart' }));
    expect(onSelectSymbol).toHaveBeenCalledWith('XAUUSD');
  });

  it('maps readiness, waiting, blocked, stale and disconnected states explicitly', () => {
    const ready = {
      status: 'READY',
      safeLotSize: 0.01,
      signal: {} as NonNullable<PairAnalysis['signal']>,
      expiryTimestamp: Date.now() + 60_000,
    } as Pick<PairAnalysis, 'status' | 'safeLotSize' | 'signal' | 'expiryTimestamp'>;
    const blocked = { ...ready, status: 'BLOCKED' as const };

    expect(getScannerCardStatus(ready, true, false)).toBe('READY');
    expect(getScannerCardStatus(null, true, false)).toBe('WAITING');
    expect(getScannerCardStatus(blocked, true, false)).toBe('BLOCKED');
    expect(getScannerCardStatus(ready, true, true)).toBe('STALE');
    expect(getScannerCardStatus(ready, false, false)).toBe('DISCONNECTED');
  });

  it('reveals separated trade, structure, confirmation and execution details on demand', () => {
    tradingEngine.stopEngineLoops();
    const now = Date.now();
    const analysis: PairAnalysis = {
      symbol: 'XAUUSD',
      displayName: 'Gold / US Dollar',
      price: 2000,
      bid: 1999.9,
      ask: 2000.1,
      spreadPoints: 20,
      spreadPips: 2,
      spreadAcceptable: true,
      m1Trend: 'bullish',
      m5Trend: 'bullish',
      m15Trend: 'ranging',
      h1Trend: 'bullish',
      swings: { high: null, low: null },
      lastBOS: { kind: 'BOS', direction: 'bullish', price: 1998, bar: 2 },
      lastCHoCH: null,
      liquidity: {
        equalHighs: [],
        equalLows: [],
        buySideLiquidity: 2010,
        sellSideLiquidity: 1985,
        recentSweep: 'low',
      },
      orderBlocks: [{ kind: 'OB', top: 1998, bottom: 1995, bullish: true, born: 1, filled: false, tests: 0 }],
      fvgs: [],
      dealingRange: { low: 1980, high: 2020, equilibrium: 2000 },
      premiumDiscountPct: 45,
      atr: 5,
      volatility: 'normal',
      sessionName: 'London',
      isPreferredSession: true,
      newsStatus: 'No high-impact news restriction',
      volumeMetrics: {
        available: true,
        currentVolume: 120,
        avgVolume20: 100,
        rvol: 1.2,
        volumeType: 'NEUTRAL',
        cvdDelta: 0,
        isInstitutionalSpike: false,
        isAbsorptionWick: false,
      },
      bias: 'BUY',
      signal: {
        strategy: 'Trend Pullback',
        direction: 'BUY',
        timeframe: 'M5',
        score: 75,
        scoringPolicyVersion: 3,
        generatedAt: new Date(now).toISOString(),
        availableAt: new Date(now).toISOString(),
        sourceCandleOpenTime: now - 60_000,
        sourceCandleCloseTime: now,
        entry: 2000,
        sl: 1990,
        tp: 2020,
        expiryTimestamp: now + 300_000,
        reasons: ['M5 pullback'],
        atr: 5,
        timestamp: new Date(now).toISOString(),
        humanExplanation: { simpleSummary: 'M5 bullish pullback from a broker-confirmed zone.' },
      } as NonNullable<PairAnalysis['signal']>,
      rawConfluenceScore: 75,
      confluenceScore: 75,
      scoringPolicyVersion: 3,
      scoreBreakdown: {
        htfAlignment: 16,
        structureConfirm: 13,
        liquiditySweep: 12,
        bosChoch: 4,
        obFvgReaction: 8,
        momentumConfirm: 7,
        sessionConfirm: 5,
        spreadAcceptable: 5,
      },
      entryPrice: 2000,
      suggestedSL: 1990,
      suggestedTP: 2020,
      expiryTimestamp: now + 300_000,
      riskRewardRatio: 2,
      status: 'READY',
      rejectionReason: null,
      safeLotSize: 0.02,
      estimatedRiskUsd: 20,
      symbolSpec: {
        point: 0.01,
        tickSize: 0.01,
        tickValue: 1,
        contractSize: 100,
        volumeMin: 0.01,
        volumeMax: 10,
        volumeStep: 0.01,
        tradeStopsLevel: 0,
        tradeFreezeLevel: 0,
      },
      rank: 1,
    };
    const onSelectSymbol = vi.fn();
    const onExecuteTrade = vi.fn();
    const onOpenWebhook = vi.fn();

    render(
      <WatchlistRail
        scannerAnalyses={[analysis]}
        activeSymbol="XAUUSD"
        onSelectSymbol={onSelectSymbol}
        onExecuteTrade={onExecuteTrade}
        onOpenWebhook={onOpenWebhook}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open XAUUSD details' }));

    const inspector = screen.getByRole('region', { name: 'XAUUSD trade details' });
    expect(inspector.textContent).toContain('Trade Plan');
    expect(inspector.textContent).toContain('Market Structure');
    expect(inspector.textContent).toContain('Confirmations');
    expect(inspector.textContent).toContain('Risk & Execution');
    expect(inspector.textContent).toContain('Verified');
    expect(screen.getByRole('button', { name: /Execute BUY/ })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Select for chart' }));
    fireEvent.click(screen.getByRole('button', { name: /Execute BUY/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Telegram' }));
    expect(onSelectSymbol).toHaveBeenCalledWith('XAUUSD');
    expect(onExecuteTrade).toHaveBeenCalledWith(analysis);
    expect(onOpenWebhook).toHaveBeenCalledTimes(1);
  });
});
