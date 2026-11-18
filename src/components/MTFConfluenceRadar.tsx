/**
 * MTFConfluenceRadar.tsx - Top-Down Multi-Timeframe Institutional Confluence Matrix
 * Reads live scanner analysis and signal state so alignments are always honest and system-synced.
 */

import React from 'react';
import { SupportedSymbol } from '../engine/instrumentConfig';
import { Signal } from '../types/smc';
import { useScannerAnalyses, useMarket } from '../hooks/useTradingStore';
import { CheckCircle2, AlertTriangle, Layers, TrendingUp, TrendingDown } from 'lucide-react';

interface MTFConfluenceRadarProps {
  symbol: SupportedSymbol;
  signal?: Signal | null;
  direction?: 'BUY' | 'SELL';
  compact?: boolean;
}

export const MTFConfluenceRadar: React.FC<MTFConfluenceRadarProps> = ({
  symbol,
  signal,
  direction,
  compact = false,
}) => {
  const analyses = useScannerAnalyses();
  const market = useMarket();
  const pairAnalysis = analyses.find((a) => a.symbol === symbol);

  const activeDirection: 'BUY' | 'SELL' | null =
    direction ||
    signal?.direction ||
    (pairAnalysis && pairAnalysis.bias !== 'WAITING' ? pairAnalysis.bias : null);

  const isBuy = activeDirection === 'BUY';
  const hasLiveData = Boolean(pairAnalysis || signal || market.brokerMarketData);

  const h1Trend = pairAnalysis?.h1Trend;
  const h1Aligned = Boolean(
    activeDirection &&
      (h1Trend
        ? (isBuy && h1Trend === 'bullish') || (!isBuy && h1Trend === 'bearish')
        : Boolean(signal))
  );

  const m15Aligned = Boolean(
    activeDirection &&
      (pairAnalysis
        ? (isBuy && pairAnalysis.m15Trend === 'bullish') || (!isBuy && pairAnalysis.m15Trend === 'bearish')
        : Boolean(signal && (signal.timeframe === 'M15' || signal.score >= 3.5 || signal.isSniper)))
  );

  const m5Aligned = Boolean(
    signal ||
      (activeDirection &&
        pairAnalysis &&
        ((isBuy && pairAnalysis.m5Trend === 'bullish') || (!isBuy && pairAnalysis.m5Trend === 'bearish')))
  );

  const alignedCount = hasLiveData ? (h1Aligned ? 1 : 0) + (m15Aligned ? 1 : 0) + (m5Aligned ? 1 : 0) : 0;
  const alignmentPercent = hasLiveData ? Math.round((alignedCount / 3) * 100) : 0;

  if (compact) {
    return (
      <div className="flex items-center gap-2 p-2 rounded-xl ws-subtle border font-mono text-xs select-none flex-wrap">
        <div className="flex items-center gap-1.5 shrink-0">
          <Layers className="w-3.5 h-3.5 text-amber-500" />
          <span className="text-[10px] font-extrabold uppercase text-slate-600 dark:text-slate-300">
            MTF:
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-1 text-[10px]">
          <span
            className={`px-1.5 py-0.5 rounded font-bold border ${
              h1Aligned
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                : 'ws-surface text-slate-500 dark:text-slate-400'
            }`}
          >
            H1: {h1Trend ? h1Trend.toUpperCase() : activeDirection ? (isBuy ? 'Bullish' : 'Bearish') : 'Idle'}
          </span>
          <span className="text-slate-400">→</span>
          <span
            className={`px-1.5 py-0.5 rounded font-bold border ${
              m15Aligned
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                : 'ws-surface text-slate-500 dark:text-slate-400'
            }`}
          >
            M15: {pairAnalysis ? pairAnalysis.m15Trend.toUpperCase() : signal ? 'POI Synced' : 'Scanning'}
          </span>
          <span className="text-slate-400">→</span>
          <span
            className={`px-1.5 py-0.5 rounded font-bold border ${
              m5Aligned
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                : 'ws-surface text-slate-500 dark:text-slate-400'
            }`}
          >
            M5: {signal ? 'Entry Ready' : 'Waiting'}
          </span>
        </div>

        <span
          className={`text-[10px] font-bold shrink-0 ${
            alignmentPercent === 100
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          {hasLiveData ? `${alignmentPercent}% Aligned` : 'Awaiting Feed'}
        </span>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-3.5 rounded-xl ws-surface border font-mono text-xs space-y-2.5">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#2b3b59] pb-2 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-amber-500" />
          <span className="font-extrabold text-xs uppercase tracking-wider text-slate-900 dark:text-white">
            Top-Down MTF Confluence
          </span>
        </div>
        <span
          className={`text-[10px] font-bold flex items-center gap-1 ${
            alignmentPercent === 100
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-amber-600 dark:text-amber-400'
          }`}
        >
          {alignmentPercent === 100 ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
          <span>{hasLiveData ? `${alignmentPercent}% Confluence` : 'Awaiting Live Feed'}</span>
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="p-2.5 rounded-xl ws-subtle border space-y-1">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase text-slate-400">
            <span>H1 Bias</span>
            <span className="flex items-center gap-0.5 text-slate-700 dark:text-slate-200">
              {activeDirection ? (isBuy ? <TrendingUp className="w-3 h-3 text-emerald-500" /> : <TrendingDown className="w-3 h-3 text-rose-500" />) : null}
              <span>{h1Trend ? h1Trend.toUpperCase() : activeDirection || 'IDLE'}</span>
            </span>
          </div>
          <div className="font-bold text-xs text-slate-900 dark:text-white leading-tight">
            {h1Aligned ? (isBuy ? 'Bullish Orderflow' : 'Bearish Orderflow') : 'No Confirmed Trend'}
          </div>
        </div>

        <div className="p-2.5 rounded-xl ws-subtle border space-y-1">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase text-slate-400">
            <span>M15 Structure</span>
            <span className={m15Aligned ? 'text-emerald-500' : 'text-amber-500'}>
              {m15Aligned ? 'ALIGNED' : 'SCANNING'}
            </span>
          </div>
          <div className="font-bold text-xs text-slate-900 dark:text-white leading-tight">
            {pairAnalysis ? `${pairAnalysis.orderBlocks.length} OB · ${pairAnalysis.fvgs.length} FVG` : 'Awaiting Zones'}
          </div>
        </div>

        <div className="p-2.5 rounded-xl ws-subtle border space-y-1">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase text-slate-400">
            <span>M5 Trigger</span>
            <span className={m5Aligned ? 'text-emerald-500' : 'text-slate-400'}>
              {signal ? 'READY' : 'PENDING'}
            </span>
          </div>
          <div className="font-bold text-xs text-slate-900 dark:text-white leading-tight">
            {signal ? `${signal.direction} ${signal.strategy}` : 'Awaiting Structural Break'}
          </div>
        </div>
      </div>
    </div>
  );
};
