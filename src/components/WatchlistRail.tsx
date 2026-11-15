import React, { useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Server,
  Send,
  Sparkles,
} from 'lucide-react';
import type { PairAnalysis } from '../engine/multiPairScanner';
import { SUPPORTED_SYMBOLS, getInstrumentConfig, type SupportedSymbol } from '../engine/instrumentConfig';
import { useEngine, useWebhookState } from '../hooks/useTradingStore';
import { tradingEngine } from '../engine/tradingEngine';
import { dispatchLiveSignalAlert } from '../utils/webhookNotifier';

interface WatchlistRailProps {
  scannerAnalyses: PairAnalysis[];
  activeSymbol: string;
  onSelectSymbol: (symbol: SupportedSymbol) => void;
  onExecuteTrade?: (analysis: PairAnalysis) => void;
  onOpenBridge?: () => void;
  onOpenWebhook?: () => void;
}

function formatHoldReason(reason: string | null): string | null {
  if (!reason) return null;
  return reason
    .replace(/^TRADE_REJECTED:\s*/i, '')
    .replace(/^WAITING:\s*/i, '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function trendLabel(t: 'bullish' | 'bearish' | 'ranging'): string {
  return t === 'bullish' ? 'Bull' : t === 'bearish' ? 'Bear' : 'Range';
}

function trendColor(t: 'bullish' | 'bearish' | 'ranging'): string {
  return t === 'bullish'
    ? 'text-emerald-600 dark:text-emerald-400'
    : t === 'bearish'
      ? 'text-rose-600 dark:text-rose-400'
      : 'text-slate-400 dark:text-slate-500';
}

export const WatchlistRail: React.FC<WatchlistRailProps> = React.memo(({
  scannerAnalyses,
  activeSymbol,
  onSelectSymbol,
  onExecuteTrade,
  onOpenBridge,
  onOpenWebhook,
}) => {
  const engine = useEngine();
  const webhook = useWebhookState();
  const autoFocus = engine.autoSelectBestScenario ?? true;
  const mt5Connected = Boolean(engine.mt5Account?.connected);

  const [collapsedCards, setCollapsedCards] = useState<Record<string, boolean>>({});
  const [sendingSym, setSendingSym] = useState<string | null>(null);
  const [tgToast, setTgToast] = useState<{ sym: string; ok: boolean; msg: string } | null>(null);

  const analyzedMap = new Map(scannerAnalyses.map((item) => [item.symbol, item]));
  const readyCount = scannerAnalyses.filter(
    (a) => a.status === 'READY' && typeof a.safeLotSize === 'number' && a.safeLotSize > 0
  ).length;

  const allCollapsed = SUPPORTED_SYMBOLS.every((sym) => collapsedCards[sym]);

  const toggleCard = (e: React.MouseEvent, sym: SupportedSymbol) => {
    e.stopPropagation();
    setCollapsedCards((prev) => ({ ...prev, [sym]: !prev[sym] }));
  };

  const toggleAllCards = () => {
    const next = !allCollapsed;
    const map: Record<string, boolean> = {};
    for (const sym of SUPPORTED_SYMBOLS) {
      map[sym] = next;
    }
    setCollapsedCards(map);
  };

  const handleBroadcastPair = async (e: React.MouseEvent, item: PairAnalysis) => {
    e.stopPropagation();
    if (!item.signal) return;
    if (!webhook.hasValidDestination) {
      onOpenWebhook?.();
      return;
    }
    setSendingSym(item.symbol);
    try {
      const res = await dispatchLiveSignalAlert({
        symbol: item.symbol,
        direction: item.signal.direction,
        timeframe: item.signal.timeframe,
        strategy: item.signal.strategy || 'SMC POI Retest',
        entry: item.signal.entry,
        sl: item.signal.sl,
        tp: item.signal.tp,
        tp2: item.suggestedTP2,
        tp3: item.suggestedTP3,
        confluenceScore: item.confluenceScore,
        lotSize: item.safeLotSize || undefined,
        riskReward: item.riskRewardRatio.toFixed(1),
        force: true,
      });
      setTgToast({
        sym: item.symbol,
        ok: res.ok,
        msg: res.ok ? 'Sent' : res.error || 'Failed',
      });
    } finally {
      setSendingSym(null);
      setTimeout(() => setTgToast(null), 2600);
    }
  };

  return (
    <section aria-label="Market Scanner" className="space-y-2.5">
      {/* Compact Scanner Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2.5 text-xs">
          <h2 className="font-bold text-slate-900 dark:text-white tracking-tight">
            Market Scanner
          </h2>
          <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
          <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            {mt5Connected ? `${readyCount} Tradeable` : 'Broker Feed Offline'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {!mt5Connected && onOpenBridge && (
            <button
              type="button"
              onClick={onOpenBridge}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-[11px] transition-colors cursor-pointer whitespace-nowrap"
            >
              <Server className="w-3 h-3 shrink-0" />
              <span>Connect MT5 Feed</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => tradingEngine.setAutoSelectBestScenario(!autoFocus)}
            aria-pressed={autoFocus}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              autoFocus
                ? 'bg-sky-500/10 border-sky-500/30 text-sky-600 dark:text-sky-400'
                : 'ws-subtle text-slate-500 dark:text-slate-400'
            }`}
            title="Auto-focus chart when a pair setup turns ready"
          >
            <Sparkles className="w-3 h-3 shrink-0" />
            <span>Auto Focus</span>
          </button>

          <button
            type="button"
            onClick={toggleAllCards}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg ws-subtle border text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer whitespace-nowrap"
          >
            {allCollapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
            <span>{allCollapsed ? 'Expand All' : 'Collapse All'}</span>
          </button>
        </div>
      </div>

      {/* 4-Pair Collapsible Square Card Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-start">
        {SUPPORTED_SYMBOLS.map((sym) => {
          const item = analyzedMap.get(sym);
          const cfg = getInstrumentConfig(sym);
          const isActive = sym === activeSymbol;
          const isCollapsed = Boolean(collapsedCards[sym]);

          // Determine real factual state
          const isBull = item?.bias === 'BUY';
          const isBear = item?.bias === 'SELL';
          const hasSafeLot = typeof item?.safeLotSize === 'number' && item.safeLotSize > 0;
          const isTradeable = item?.status === 'READY' && hasSafeLot && Boolean(item.signal);

          const statusText = !item
            ? mt5Connected
              ? 'Syncing Feed'
              : 'Offline'
            : isTradeable
              ? `${item.bias} Setup`
              : item.status === 'BLOCKED'
                ? 'Blocked'
                : item.bias === 'WAITING'
                  ? 'No Trend'
                  : `${item.bias} Bias`;

          const statusTone = !item
            ? 'text-slate-400 dark:text-slate-500'
            : isTradeable
              ? isBull
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
              : item.status === 'BLOCKED'
                ? 'text-amber-600 dark:text-amber-400'
                : isBull
                  ? 'text-emerald-600/80 dark:text-emerald-400/80'
                  : isBear
                    ? 'text-rose-600/80 dark:text-rose-400/80'
                    : 'text-slate-500 dark:text-slate-400';

          const atrPips = item && item.atr > 0 ? (item.atr / cfg.pipSize).toFixed(1) : null;
          const holdReason = item ? formatHoldReason(item.rejectionReason) : null;

          return (
              <article
              key={sym}
              onClick={() => onSelectSymbol(sym)}
              className={`ws-surface border rounded-xl transition-all cursor-pointer flex flex-col justify-between overflow-hidden ${
                isCollapsed ? '' : 'lg:aspect-square'
              } ${
                isActive
                  ? 'border-sky-500 dark:border-sky-400 ring-2 ring-sky-500/30 dark:ring-sky-400/25'
                  : 'hover:border-slate-400 dark:hover:border-[#3b527a]'
              }`}
            >
              {/* Card Header (Always visible) */}
              <div className={`px-3.5 py-2.5 border-b flex items-center justify-between gap-2 shrink-0 ${
                isActive ? 'bg-sky-500/10 dark:bg-sky-500/15 border-sky-500/30' : 'ws-subtle'
              }`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-extrabold text-[13px] text-slate-900 dark:text-white tracking-tight">
                      {sym}
                    </span>
                    <span className={`inline-flex items-center gap-1 font-mono text-[11px] font-semibold ${statusTone}`}>
                      {isBull && <TrendingUp className="w-3 h-3 shrink-0" />}
                      {isBear && <TrendingDown className="w-3 h-3 shrink-0" />}
                      {!isBull && !isBear && <Minus className="w-3 h-3 shrink-0" />}
                      <span>{statusText}</span>
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                    {cfg.displayName}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right font-mono tabular-nums">
                    <div className="text-[13px] font-extrabold text-slate-950 dark:text-white">
                      {item && item.bid > 0 ? item.bid.toFixed(cfg.digits) : '—'}
                    </div>
                    <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                      {item ? `${item.spreadPips}p spd` : 'No Quote'}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => toggleCard(e, sym)}
                    aria-expanded={!isCollapsed}
                    aria-label={isCollapsed ? `Expand ${sym} scanner card` : `Collapse ${sym} scanner card`}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-[#1b2130] transition-colors cursor-pointer"
                  >
                    {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Expanded Square Card Body: Strictly Verifiable Market Data */}
              {!isCollapsed && (
                <div className="p-3.5 flex-1 flex flex-col justify-between gap-2.5 text-xs">
                  {!item ? (
                    <div className="flex-1 flex flex-col justify-center items-center text-center px-2 space-y-2">
                      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                        {mt5Connected
                          ? `Waiting for ${sym} M1–H1 broker candles from MT5 bridge.`
                          : `Connect MT5 Bridge to stream real ${sym} quotes, spreads, and liquidity levels.`}
                      </p>
                      <span className="font-mono text-[11px] text-slate-400">
                        Max Spread: {cfg.maxSpreadPoints} pts · Min R:R 1:{cfg.minRR}
                      </span>
                    </div>
                  ) : (
                    <>
                      {/* Real Market Structure (4 Timeframes) */}
                      <div className="space-y-2.5">
                        <div className="grid grid-cols-4 gap-1 py-1.5 border-b border-slate-200/80 dark:border-[#2b3b59] font-mono text-[11px] text-center">
                          {(
                            [
                              ['M1', item.m1Trend],
                              ['M5', item.m5Trend],
                              ['M15', item.m15Trend],
                              ['H1', item.h1Trend],
                            ] as const
                          ).map(([tf, tr]) => (
                            <div key={tf}>
                              <span className="block text-[10px] text-slate-400">{tf}</span>
                              <span className={`font-semibold ${trendColor(tr)}`}>{trendLabel(tr)}</span>
                            </div>
                          ))}
                        </div>

                        {/* Verifiable Liquidity, Volatility & Spread Metrics */}
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-[11px] tabular-nums">
                          <div>
                            <span className="text-[10px] text-slate-400 block font-sans">Volatility (ATR M15)</span>
                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                              {atrPips ? `${atrPips} pips` : '—'}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-[10px] text-slate-400 block font-sans">Spread / Max</span>
                            <span
                              className={`font-semibold ${
                                !item.spreadAcceptable
                                  ? 'text-rose-500'
                                  : 'text-slate-800 dark:text-slate-200'
                              }`}
                            >
                              {item.spreadPoints} / {cfg.maxSpreadPoints} pts
                            </span>
                          </div>

                          <div>
                            <span className="text-[10px] text-slate-400 block font-sans">High Liquidity (BSL)</span>
                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                              {item.liquidity.buySideLiquidity
                                ? item.liquidity.buySideLiquidity.toFixed(cfg.digits)
                                : '—'}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-[10px] text-slate-400 block font-sans">Low Liquidity (SSL)</span>
                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                              {item.liquidity.sellSideLiquidity
                                ? item.liquidity.sellSideLiquidity.toFixed(cfg.digits)
                                : '—'}
                            </span>
                          </div>
                        </div>

                        {/* Structural Footprint & Event State */}
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between gap-2 pt-1 border-t border-slate-100 dark:border-[#2b3b59]">
                          <span className="truncate">
                            Zones: {item.orderBlocks.length} OB · {item.fvgs.length} FVG
                          </span>
                          <span className="font-mono shrink-0">
                            {item.liquidity.recentSweep === 'high'
                              ? 'Swept High'
                              : item.liquidity.recentSweep === 'low'
                                ? 'Swept Low'
                                : `${item.premiumDiscountPct}% Range`}
                          </span>
                        </div>
                      </div>

                      {/* Real Setup Trade Levels OR Explicit Non-Trade Gate */}
                      <div className="pt-2 border-t border-slate-200/80 dark:border-[#2b3b59] space-y-2">
                        {item.signal ? (
                          <>
                            <div className="grid grid-cols-3 gap-1 font-mono text-[11px] tabular-nums">
                              <div>
                                <span className="text-[10px] text-slate-400 block font-sans">SL ({item.slPips}p)</span>
                                <span className="font-semibold text-rose-600 dark:text-rose-400">
                                  {item.suggestedSL.toFixed(cfg.digits)}
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 block font-sans">TP (1:{item.riskRewardRatio.toFixed(1)})</span>
                                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                  {item.suggestedTP.toFixed(cfg.digits)}
                                </span>
                              </div>
                              <div className="text-right">
                                <span className="text-[10px] text-slate-400 block font-sans">Safe Lot</span>
                                <span className="font-semibold text-slate-900 dark:text-white">
                                  {hasSafeLot ? `${item.safeLotSize?.toFixed(2)}L` : 'Hold'}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5">
                              {isTradeable && onExecuteTrade ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onExecuteTrade(item);
                                  }}
                                  className={`flex-1 py-1.5 px-2.5 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                                    isBull
                                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                      : 'bg-rose-600 hover:bg-rose-700 text-white'
                                  }`}
                                >
                                  <span>Execute {item.bias} {item.safeLotSize?.toFixed(2)}L</span>
                                  <ArrowRight className="w-3 h-3 shrink-0" />
                                </button>
                              ) : (
                                <span className="flex-1 text-[11px] text-amber-600 dark:text-amber-400 font-medium truncate">
                                  {holdReason || 'Pending trigger'}
                                </span>
                              )}

                              <button
                                type="button"
                                disabled={sendingSym === sym}
                                onClick={(e) => handleBroadcastPair(e, item)}
                                title={
                                  webhook.hasValidDestination
                                    ? `Send ${sym} ${item.signal.direction} signal to Telegram`
                                    : 'Configure Telegram Alerts'
                                }
                                className="p-1.5 rounded-lg ws-subtle border text-sky-600 dark:text-sky-400 hover:bg-sky-500/10 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                              >
                                <Send className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                            {holdReason || 'Monitoring H1/M15 structure alignment — no trade setup active.'}
                          </div>
                        )}

                        {tgToast && tgToast.sym === sym && (
                          <div
                            className={`text-[10px] font-mono font-semibold ${
                              tgToast.ok ? 'text-emerald-500' : 'text-rose-500'
                            }`}
                          >
                            TG: {tgToast.msg}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
});
