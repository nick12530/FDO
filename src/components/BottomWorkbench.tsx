import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  RefreshCw,
  ExternalLink,
  Activity,
  Globe,
  ShieldCheck,
  Send,
  Power,
  RotateCcw,
  Trash2,
  Sliders,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import {
  usePositions,
  useTicker,
  useEngine,
  useMarket,
  useMacroSentiment,
  useScannerAnalyses,
  useWebhookState,
  useSignalValidations,
} from '../hooks/useTradingStore';
import { tradingEngine } from '../engine/tradingEngine';
import {
  SUPPORTED_SYMBOLS,
  getInstrumentConfig,
  type SupportedSymbol,
} from '../engine/instrumentConfig';
import { newsSentimentEngine } from '../engine/newsSentimentEngine';
import { calculateRVOL } from '../engine/volumeEngine';
import {
  estimatePortfolioStopRisk,
  getCandleAgeMs,
  summarizeClosedTrades,
  summarizeStrategyAttribution,
} from '../engine/tradingDiagnostics';
import { RISK_CONFIG } from '../engine/riskConfig';
import {
  setWebhookEnabled,
  clearWebhookLog,
  clearSignalCooldowns,
  dispatchLiveSignalAlert,
  getSignalCooldownRemainingMs,
} from '../utils/webhookNotifier';
import type { NewsSentimentItem, EconomicEvent } from '../types/smc';
import type { PairAnalysis } from '../engine/multiPairScanner';

type WorkbenchTab = 'positions' | 'macro' | 'telegram' | 'health';

interface BottomWorkbenchProps {
  onOpenTradeStation: () => void;
  onOpenWebhook?: () => void;
}

function formatCooldown(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

export const BottomWorkbench: React.FC<BottomWorkbenchProps> = React.memo(({
  onOpenTradeStation,
  onOpenWebhook,
}) => {
  const { positions, closedTrades, pendingOrders = [] } = usePositions();
  const ticker = useTicker();
  const engine = useEngine();
  const market = useMarket();
  const macro = useMacroSentiment();
  const analyses = useScannerAnalyses();
  const webhook = useWebhookState();
  const validations = useSignalValidations();

  const [activeTab, setActiveTab] = useState<WorkbenchTab>('positions');
  const [macroSubTab, setMacroSubTab] = useState<'news' | 'calendar' | 'volume'>('news');
  const [isRefreshingNews, setIsRefreshingNews] = useState(false);
  const [customHeadline, setCustomHeadline] = useState('');
  const [sendingSymbol, setSendingSymbol] = useState<string | null>(null);
  const [tgDispatchNote, setTgDispatchNote] = useState<{ ok: boolean; msg: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 2000);
    return () => window.clearInterval(id);
  }, []);

  const totalPositions = positions.length;
  const totalFloatingPnl = Number(positions.reduce((sum, p) => sum + p.profit, 0).toFixed(2));
  const isOverallProfitable = totalFloatingPnl >= 0;

  const activeSymbol = (ticker.symbol || 'XAUUSD') as SupportedSymbol;
  const activeCfg = getInstrumentConfig(activeSymbol);
  const currentCandles = market.candlesM5.length >= 10 ? market.candlesM5 : market.candlesM1;
  const volumeMetrics = useMemo(
    () => calculateRVOL(currentCandles, 20, activeCfg.digits),
    [currentCandles, activeCfg.digits]
  );

  const intermarket = macro?.intermarket;
  const hasIntermarket = Boolean(intermarket?.hasLiveData);
  const newsStatus = newsSentimentEngine.getStatus();

  const metrics = useMemo(() => summarizeClosedTrades(closedTrades), [closedTrades]);
  const strategyAttribution = useMemo(
    () => summarizeStrategyAttribution(closedTrades, validations),
    [closedTrades, validations]
  );
  const symbolSpecs = useMemo(() => {
    const specs: Record<string, NonNullable<PairAnalysis['symbolSpec']>> = {};
    for (const analysis of analyses) {
      if (analysis.symbolSpec) specs[analysis.symbol] = analysis.symbolSpec;
    }
    if (market.symbolSpec) specs[ticker.symbol] = market.symbolSpec;
    return specs;
  }, [analyses, market.symbolSpec, ticker.symbol]);

  const portfolioRisk = useMemo(
    () => estimatePortfolioStopRisk(positions, pendingOrders, symbolSpecs, ticker.symbol),
    [positions, pendingOrders, symbolSpecs, ticker.symbol]
  );

  const portfolioRiskLimit = ticker.equity * (RISK_CONFIG.maxPortfolioRiskPercent / 100);
  const candleAge = getCandleAgeMs(market.candlesM1, now);
  const quoteAge =
    ticker.quoteUpdatedAt && ticker.quoteUpdatedAt > 0
      ? Math.max(0, now - ticker.quoteUpdatedAt)
      : null;

  const feedHealthy =
    Boolean(ticker.marketDataAvailable) &&
    quoteAge !== null &&
    quoteAge <= 45_000 &&
    candleAge !== null &&
    candleAge <= 120_000;

  const handleRefreshLiveNews = async () => {
    setIsRefreshingNews(true);
    try {
      await newsSentimentEngine.fetchLiveNews(true);
    } finally {
      setIsRefreshingNews(false);
    }
  };

  const handleAddCustomNews = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customHeadline.trim()) return;
    const scored = newsSentimentEngine.scoreHeadline(customHeadline.trim());
    newsSentimentEngine.addHeadline({
      title: customHeadline.trim(),
      source: 'Desk Note',
      sentimentScore: scored.score,
      urgency: 'BREAKING',
      catalystType: scored.catalyst,
      affectedAssets: [activeSymbol, 'USD'],
      summary: 'Manual catalyst added to session radar.',
    });
    setCustomHeadline('');
  };

  const handleToggleTelegramSync = () => {
    if (!webhook.hasValidDestination) {
      onOpenWebhook?.();
      return;
    }
    setWebhookEnabled(!webhook.config.enabled);
  };

  const handleSendPairSignal = async (analysis: PairAnalysis) => {
    if (!analysis.signal) return;
    if (!webhook.hasValidDestination) {
      onOpenWebhook?.();
      return;
    }
    setSendingSymbol(analysis.symbol);
    setTgDispatchNote(null);
    try {
      const res = await dispatchLiveSignalAlert({
        symbol: analysis.symbol,
        direction: analysis.signal.direction,
        timeframe: analysis.signal.timeframe,
        strategy: analysis.signal.strategy || 'SMC POI Retest',
        entry: analysis.signal.entry,
        sl: analysis.signal.sl,
        tp: analysis.signal.tp,
        tp2: analysis.suggestedTP2,
        tp3: analysis.suggestedTP3,
        confluenceScore: analysis.confluenceScore,
        lotSize: analysis.safeLotSize || undefined,
        riskReward: analysis.riskRewardRatio.toFixed(1),
        force: true,
      });
      setTgDispatchNote({
        ok: res.ok,
        msg: res.ok
          ? `${analysis.symbol} ${analysis.signal.direction} signal dispatched to ${webhook.config.type}.`
          : res.error || 'Failed to dispatch signal.',
      });
    } finally {
      setSendingSymbol(null);
      setTimeout(() => setTgDispatchNote(null), 3500);
    }
  };

  const analysisBySymbol = useMemo(() => {
    const map = new Map<SupportedSymbol, PairAnalysis>();
    for (const a of analyses) map.set(a.symbol, a);
    return map;
  }, [analyses]);

  const telegramBadgeColor =
    webhook.status === 'ACTIVE'
      ? 'text-emerald-500'
      : webhook.status === 'ERROR'
        ? 'text-rose-500'
        : webhook.status === 'PAUSED'
          ? 'text-amber-500'
          : 'text-slate-400';

  return (
    <section className="ws-surface border rounded-xl overflow-hidden flex flex-col">
      {/* Tab Header Strip */}
      <div className="px-3.5 py-2 ws-subtle border-b flex items-center justify-between gap-3 flex-wrap">
        <div role="tablist" aria-label="Workstation lower dock" className="flex items-center gap-1 flex-wrap">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'positions'}
            onClick={() => setActiveTab('positions')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'positions'
                ? 'bg-white dark:bg-[#090b10] text-slate-900 dark:text-white border border-slate-200 dark:border-[#2a3347]'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-transparent'
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span>Positions ({totalPositions})</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'macro'}
            onClick={() => setActiveTab('macro')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'macro'
                ? 'bg-white dark:bg-[#090b10] text-slate-900 dark:text-white border border-slate-200 dark:border-[#2a3347]'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-transparent'
            }`}
          >
            <Globe className="w-3.5 h-3.5 text-sky-500 shrink-0" />
            <span>Macro &amp; News</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'telegram'}
            onClick={() => setActiveTab('telegram')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'telegram'
                ? 'bg-white dark:bg-[#090b10] text-slate-900 dark:text-white border border-slate-200 dark:border-[#2a3347]'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-transparent'
            }`}
          >
            <Send className={`w-3.5 h-3.5 shrink-0 ${telegramBadgeColor}`} />
            <span>Telegram Signals</span>
            <span
              className={`font-mono text-[10px] px-1.5 py-0.2 rounded font-bold ${
                webhook.status === 'ACTIVE'
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : webhook.status === 'ERROR'
                    ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                    : webhook.status === 'PAUSED'
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : 'bg-slate-200 dark:bg-[#1a202e] text-slate-500'
              }`}
            >
              {webhook.status}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'health'}
            onClick={() => setActiveTab('health')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'health'
                ? 'bg-white dark:bg-[#090b10] text-slate-900 dark:text-white border border-slate-200 dark:border-[#2a3347]'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-transparent'
            }`}
          >
            <ShieldCheck className={`w-3.5 h-3.5 shrink-0 ${feedHealthy ? 'text-emerald-500' : 'text-amber-500'}`} />
            <span>Health &amp; Risk</span>
          </button>
        </div>

        {/* Contextual Right Summary */}
        <div className="flex items-center gap-2.5 text-xs">
          {activeTab === 'positions' && (
            <>
              <div className="flex items-center gap-1.5 font-mono">
                <span className="text-slate-400">Floating:</span>
                <span
                  className={`font-bold tabular-nums ${
                    isOverallProfitable ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {isOverallProfitable ? '+' : ''}${totalFloatingPnl.toFixed(2)}
                </span>
              </div>
              {totalPositions > 0 && (
                <button
                  type="button"
                  onClick={() => tradingEngine.closeAll('Manual')}
                  className="px-2.5 py-1 rounded-md bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/25 font-semibold text-[11px] transition-colors cursor-pointer"
                >
                  Close All
                </button>
              )}
              <button
                type="button"
                onClick={onOpenTradeStation}
                className="text-[11px] font-semibold text-sky-600 dark:text-sky-400 hover:underline cursor-pointer"
              >
                History &amp; Calendar
              </button>
            </>
          )}

          {activeTab === 'macro' && (
            <button
              type="button"
              onClick={handleRefreshLiveNews}
              disabled={isRefreshingNews || newsStatus.isFetching}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white dark:bg-[#090b10] border border-slate-200 dark:border-[#2b3b59] text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#1b2130] transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${isRefreshingNews || newsStatus.isFetching ? 'animate-spin text-sky-500' : ''}`} />
              <span>{isRefreshingNews || newsStatus.isFetching ? 'Syncing...' : 'Refresh News'}</span>
            </button>
          )}

          {activeTab === 'telegram' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleTelegramSync}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md border text-[11px] font-bold transition-colors cursor-pointer ${
                  webhook.config.enabled && webhook.hasValidDestination
                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                    : 'bg-amber-500 hover:bg-amber-400 border-amber-500 text-slate-950'
                }`}
              >
                <Power className="w-3 h-3" />
                <span>
                  {!webhook.hasValidDestination
                    ? 'Link Bot'
                    : webhook.config.enabled
                      ? 'Pause Sync'
                      : 'Activate Sync'}
                </span>
              </button>
              {onOpenWebhook && (
                <button
                  type="button"
                  onClick={onOpenWebhook}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-white dark:bg-[#090b10] border border-slate-200 dark:border-[#2b3b59] text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#1b2130] cursor-pointer"
                >
                  <Sliders className="w-3 h-3" />
                  <span>Bot Settings</span>
                </button>
              )}
            </div>
          )}

          {activeTab === 'health' && (
            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              {feedHealthy ? 'Feed Verified' : 'Checking Feed'} · Portfolio Risk ${portfolioRisk.riskUsd.toFixed(2)} / ${portfolioRiskLimit.toFixed(2)}
            </span>
          )}
        </div>
      </div>

      {/* Tab Body */}
      <div className="p-3.5">
        {/* 1. POSITIONS & PENDING LIMIT ORDERS */}
        {activeTab === 'positions' && (
          <div className="space-y-3">
            {totalPositions === 0 ? (
              <div className="py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>
                  No open positions · Leverage 1:{engine.leverage || 2000} · Standing by for confirmed SMC setups.
                </span>
                <button
                  type="button"
                  onClick={onOpenTradeStation}
                  className="text-sky-600 dark:text-sky-400 font-semibold hover:underline cursor-pointer"
                >
                  Open History &amp; P&amp;L Calendar
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-[#2b3b59] text-[11px] text-slate-500 dark:text-slate-400 font-semibold">
                      <th className="py-2 pr-3">Symbol</th>
                      <th className="py-2 pr-3">Side</th>
                      <th className="py-2 pr-3 text-right">Volume</th>
                      <th className="py-2 pr-3 text-right">Entry</th>
                      <th className="py-2 pr-3 text-right">Spot</th>
                      <th className="py-2 pr-3 text-right">Pips</th>
                      <th className="py-2 pr-3 text-right">P&amp;L</th>
                      <th className="py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-[#2b3b59] font-mono">
                    {positions.map((pos) => {
                      const isBuy = pos.type === 'BUY';
                      const isPosProfit = pos.profit >= 0;
                      const posSymbol = pos.symbol || ticker.symbol || 'XAUUSD';
                      const cfg = getInstrumentConfig(posSymbol);
                      const hasLiveQuote = ticker.symbol === posSymbol;
                      const pipsGain = Number(pos.pips.toFixed(1));
                      const currentPrice = hasLiveQuote
                        ? isBuy ? ticker.bid : ticker.ask
                        : pos.price_open + (isBuy ? pipsGain : -pipsGain) * cfg.pipSize;

                      return (
                        <tr key={pos.ticket} className="hover:bg-slate-50/70 dark:hover:bg-[#151924]/70">
                          <td className="py-2.5 pr-3 font-bold text-slate-900 dark:text-white">{posSymbol}</td>
                          <td className="py-2.5 pr-3">
                            <span className={`font-bold ${isBuy ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                              {pos.type}
                            </span>
                          </td>
                          <td className="py-2.5 pr-3 text-right tabular-nums text-slate-700 dark:text-slate-300">{pos.volume.toFixed(2)}L</td>
                          <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600 dark:text-slate-300">{pos.price_open.toFixed(cfg.digits)}</td>
                          <td className="py-2.5 pr-3 text-right tabular-nums text-slate-900 dark:text-white">{currentPrice.toFixed(cfg.digits)}</td>
                          <td className={`py-2.5 pr-3 text-right tabular-nums ${pipsGain >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {pipsGain > 0 ? `+${pipsGain}` : pipsGain}
                          </td>
                          <td className={`py-2.5 pr-3 text-right font-bold tabular-nums ${isPosProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {isPosProfit ? '+' : ''}${pos.profit.toFixed(2)}
                          </td>
                          <td className="py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => tradingEngine.closePosition(pos.ticket, 'Manual')}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-rose-500/15 text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 transition-colors cursor-pointer"
                              title="Close position"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>Close</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {pendingOrders.length > 0 && (
              <div className="pt-2 border-t border-slate-200 dark:border-[#2b3b59]">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
                  Pending OTE Limit Orders ({pendingOrders.length})
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-[#2b3b59] text-[11px] text-slate-500 dark:text-slate-400 font-semibold">
                        <th className="py-1.5 pr-3">Symbol</th>
                        <th className="py-1.5 pr-3">Order</th>
                        <th className="py-1.5 pr-3 text-right">Vol</th>
                        <th className="py-1.5 pr-3 text-right">Limit</th>
                        <th className="py-1.5 pr-3 text-right">SL / TP</th>
                        <th className="py-1.5 pr-3 text-right">TTL</th>
                        <th className="py-1.5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-[#2b3b59] font-mono">
                      {pendingOrders.map((order) => {
                        const ordSym = order.symbol || ticker.symbol || 'XAUUSD';
                        const ordCfg = getInstrumentConfig(ordSym);
                        return (
                          <tr key={order.ticket} className="hover:bg-slate-50/70 dark:hover:bg-[#151924]/70">
                            <td className="py-2 pr-3 font-bold text-slate-900 dark:text-white">
                              {ordSym}
                              {order.isBrokerOrder && (
                                <span className="ml-1.5 text-[10px] font-sans font-semibold text-sky-500">MT5</span>
                              )}
                            </td>
                            <td className="py-2 pr-3">
                              <span className={`font-bold ${order.direction === 'BUY' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                {order.type}
                              </span>
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums text-slate-700 dark:text-slate-300">
                              {order.volume.toFixed(2)}L
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums text-slate-900 dark:text-white">
                              {order.entry.toFixed(ordCfg.digits)}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums text-slate-500 dark:text-slate-400">
                              {order.sl > 0 ? order.sl.toFixed(ordCfg.digits) : '—'} / {order.tp > 0 ? order.tp.toFixed(ordCfg.digits) : '—'}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums text-slate-500 dark:text-slate-400">
                              {order.remainingSeconds > 0 ? `${order.remainingSeconds}s` : 'Active'}
                            </td>
                            <td className="py-2 text-right">
                              <button
                                type="button"
                                onClick={() => tradingEngine.cancelPendingOrder(order.ticket)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-rose-500/15 text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 transition-colors cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                                <span>Cancel</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 2. MACRO, NEWS & VOLUME */}
        {activeTab === 'macro' && (
          <div className="space-y-3">
            {/* Honest Intermarket Telemetry Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pb-3 border-b border-slate-200 dark:border-[#2b3b59] text-xs">
              <div>
                <span className="text-[11px] text-slate-400 block">Regime</span>
                <span className="font-semibold text-slate-900 dark:text-white">
                  {hasIntermarket && intermarket
                    ? intermarket.riskRegime === 'RISK_OFF'
                      ? 'Risk-Off Safe Haven'
                      : intermarket.riskRegime === 'RISK_ON'
                        ? 'Risk-On Liquidity'
                        : 'Neutral Flow'
                    : 'Awaiting Live Quotes'}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-slate-400 block">Tick RVOL ({activeSymbol})</span>
                <span className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                  {currentCandles.length >= 5 && volumeMetrics.available
                    ? `${volumeMetrics.rvol}x · ${volumeMetrics.volumeType}`
                    : 'Unavailable'}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-slate-400 block">DXY Dollar Proxy</span>
                <span className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                  {hasIntermarket && intermarket
                    ? `${intermarket.dxyBias.toUpperCase()} (${intermarket.dxyChangePct >= 0 ? `+${intermarket.dxyChangePct}%` : `${intermarket.dxyChangePct}%`})`
                    : '—'}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-slate-400 block">Volatility Proxy</span>
                <span className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                  {hasIntermarket && intermarket ? `${intermarket.vixLevel} · ${intermarket.vixRegime}` : '—'}
                </span>
              </div>
            </div>

            {/* Sub-navigation */}
            <div className="flex items-center gap-1.5 text-xs">
              {(
                [
                  { id: 'news', label: `Live News (${macro?.newsItems.length || 0})` },
                  { id: 'calendar', label: `Calendar (${macro?.economicEvents.length || 0})` },
                  { id: 'volume', label: 'Order Flow' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setMacroSubTab(t.id)}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                    macroSubTab === t.id
                      ? 'ws-subtle text-slate-900 dark:text-white border border-slate-200 dark:border-[#2a3347]'
                      : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {macroSubTab === 'news' && (
              <div className="space-y-2.5">
                <form onSubmit={handleAddCustomNews} className="flex gap-2">
                  <input
                    type="text"
                    value={customHeadline}
                    onChange={(e) => setCustomHeadline(e.target.value)}
                    placeholder="Log breaking news headline or macro catalyst..."
                    className="flex-1 ws-subtle border rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-hidden"
                  />
                  <button
                    type="submit"
                    disabled={!customHeadline.trim()}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950 font-semibold text-xs disabled:opacity-40 cursor-pointer whitespace-nowrap"
                  >
                    Add Note
                  </button>
                </form>

                <div className="divide-y divide-slate-100 dark:divide-[#2b3b59] max-h-52 overflow-y-auto">
                  {macro?.newsItems && macro.newsItems.length > 0 ? (
                    macro.newsItems.map((item: NewsSentimentItem) => (
                      <div key={item.id} className="py-2 flex items-start justify-between gap-3 text-xs">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">{item.title}</span>
                            {item.link && (
                              <a
                                href={item.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sky-600 dark:text-sky-400 hover:underline inline-flex items-center gap-0.5 text-[11px] shrink-0"
                              >
                                <span>Source</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-slate-400">
                            <span>{item.source}</span>
                            <span>·</span>
                            <span className="font-mono">{item.publishedAt}</span>
                            <span>·</span>
                            <span className={`font-mono font-semibold ${item.sentimentScore > 0 ? 'text-emerald-500' : item.sentimentScore < 0 ? 'text-rose-500' : 'text-slate-400'}`}>
                              {item.sentimentScore > 0 ? `+${(item.sentimentScore * 100).toFixed(0)} Bullish` : item.sentimentScore < 0 ? `${(item.sentimentScore * 100).toFixed(0)} Bearish` : 'Neutral'}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="py-4 text-center text-slate-400 text-xs">
                      {newsStatus.isFetching
                        ? 'Fetching live RSS market headlines...'
                        : newsStatus.lastError || 'No live RSS headlines loaded yet. Click Refresh News.'}
                    </div>
                  )}
                </div>
              </div>
            )}

            {macroSubTab === 'calendar' && (
              <div className="divide-y divide-slate-100 dark:divide-[#2b3b59] max-h-52 overflow-y-auto">
                {macro?.economicEvents && macro.economicEvents.length > 0 ? (
                  macro.economicEvents.map((event: EconomicEvent) => (
                    <div key={event.id} className="py-2 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100">{event.event}</div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          {event.currency} · Forecast: {event.forecast} · Prev: {event.previous}
                        </div>
                      </div>
                      <span className="font-mono font-semibold text-slate-600 dark:text-slate-300 tabular-nums">
                        {event.time}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="py-4 text-center text-slate-400">No upcoming high-impact events loaded.</div>
                )}
              </div>
            )}

            {macroSubTab === 'volume' && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 text-xs">
                <div>
                  <span className="text-[11px] text-slate-400 block">Tick RVOL Proxy</span>
                  <span className="font-mono font-semibold text-slate-900 dark:text-white">
                    {currentCandles.length >= 5 && volumeMetrics.available
                      ? `${volumeMetrics.rvol}x`
                      : 'Unavailable'}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 block">Tick-volume Pattern</span>
                  <span className="font-mono font-semibold text-slate-900 dark:text-white">
                    {currentCandles.length >= 5 && volumeMetrics.available
                      ? volumeMetrics.volumeType
                      : 'Unavailable'}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 block">Candle-volume Proxy</span>
                  <span className="font-mono font-semibold text-slate-900 dark:text-white">
                    {currentCandles.length >= 5 && volumeMetrics.available
                      ? (volumeMetrics.cvdDelta > 0 ? `+${volumeMetrics.cvdDelta}` : volumeMetrics.cvdDelta)
                      : 'Unavailable'}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 block">Tick-volume POC Proxy</span>
                  <span className="font-mono font-semibold text-slate-900 dark:text-white">
                    {volumeMetrics.available && volumeMetrics.pocPrice
                      ? volumeMetrics.pocPrice.toFixed(getInstrumentConfig(activeSymbol).digits)
                      : 'Unavailable'}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 3. TELEGRAM SIGNALS & SYSTEM SYNC DESK */}
        {activeTab === 'telegram' && (
          <div className="space-y-3.5 text-xs">
            {!webhook.hasValidDestination && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-3 flex-wrap">
                <div className="text-amber-800 dark:text-amber-200">
                  <span className="font-bold block">Telegram Bot &amp; Chat ID Not Configured</span>
                  <span className="text-[11px]">
                    Add your @BotFather token and Chat ID in Bot Settings to stream live scanner setups and fill confirmations.
                  </span>
                </div>
                {onOpenWebhook && (
                  <button
                    type="button"
                    onClick={onOpenWebhook}
                    className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px] cursor-pointer shrink-0"
                  >
                    Configure Bot
                  </button>
                )}
              </div>
            )}

            {webhook.lastError && webhook.status === 'ERROR' && (
              <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 flex items-center gap-2 text-[11px]">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span className="font-semibold">Last delivery issue: {webhook.lastError}</span>
              </div>
            )}

            {tgDispatchNote && (
              <div
                className={`p-2.5 rounded-lg border flex items-center gap-2 text-[11px] font-semibold ${
                  tgDispatchNote.ok
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                }`}
              >
                {tgDispatchNote.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
                <span>{tgDispatchNote.msg}</span>
              </div>
            )}

            {/* Policy Summary & Controls */}
            <div className="flex items-center justify-between gap-3 flex-wrap pb-2.5 border-b border-slate-200 dark:border-[#2b3b59] font-mono text-[11px]">
              <div className="flex items-center gap-3 flex-wrap text-slate-600 dark:text-slate-300">
                <span>
                  Channel: <strong className="text-slate-900 dark:text-white uppercase">{webhook.config.type}</strong>
                </span>
                <span>·</span>
                <span>
                  Min Confluence: <strong className="text-slate-900 dark:text-white">{webhook.config.minConfluenceScore}/100</strong>
                </span>
                <span>·</span>
                <span>
                  Filter: <strong className="text-slate-900 dark:text-white">{webhook.config.onlySniperSignals ? 'Sniper POI Only' : 'All Confirmed'}</strong>
                </span>
                <span>·</span>
                <span>
                  Sent/Fail: <strong className="text-emerald-600 dark:text-emerald-400">{webhook.sentCount}</strong>/
                  <strong className="text-rose-600 dark:text-rose-400">{webhook.failedCount}</strong>
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={clearSignalCooldowns}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded ws-subtle border text-[11px] font-sans font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                  title="Allow immediate re-broadcast of active scanner pairs"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset Cooldowns</span>
                </button>
                {webhook.deliveryLog.length > 0 && (
                  <button
                    type="button"
                    onClick={clearWebhookLog}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded ws-subtle border text-[11px] font-sans font-semibold text-slate-600 dark:text-slate-300 hover:text-rose-500 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Clear Log</span>
                  </button>
                )}
              </div>
            </div>

            {/* Live Scanner Broadcast Matrix + Recent Delivery Log */}
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-3.5">
              {/* Pair Matrix */}
              <div className="overflow-x-auto border border-slate-200 dark:border-[#2b3b59] rounded-lg">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead>
                    <tr className="ws-subtle border-b border-slate-200 dark:border-[#2b3b59] text-slate-500 dark:text-slate-400 font-semibold">
                      <th className="py-1.5 px-2.5">Pair</th>
                      <th className="py-1.5 px-2">Setup</th>
                      <th className="py-1.5 px-2 text-right">Score</th>
                      <th className="py-1.5 px-2">Sync Gate</th>
                      <th className="py-1.5 px-2.5 text-right">Dispatch</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-[#2b3b59] font-mono">
                    {SUPPORTED_SYMBOLS.map((sym) => {
                      const analysis = analysisBySymbol.get(sym);
                      const cfg = getInstrumentConfig(sym);
                      const sig = analysis?.signal;
                      const score = analysis?.confluenceScore ?? 0;
                      const cooldownMs = sig
                        ? getSignalCooldownRemainingMs(sym, sig.direction, sig.timeframe)
                        : 0;

                      let gateLabel = 'WAITING';
                      let gateClass = 'text-slate-400';

                      if (sig && analysis) {
                        if (score < webhook.config.minConfluenceScore) {
                          gateLabel = `BELOW ${webhook.config.minConfluenceScore}`;
                          gateClass = 'text-amber-500';
                        } else if (webhook.config.onlySniperSignals && !analysis.isSniper) {
                          gateLabel = 'SNIPER ONLY';
                          gateClass = 'text-amber-500';
                        } else if (cooldownMs > 0) {
                          gateLabel = `CD ${formatCooldown(cooldownMs)}`;
                          gateClass = 'text-sky-500';
                        } else if (!webhook.config.enabled) {
                          gateLabel = 'PAUSED';
                          gateClass = 'text-amber-500';
                        } else {
                          gateLabel = 'SYNCED';
                          gateClass = 'text-emerald-500 font-bold';
                        }
                      }

                      return (
                        <tr key={sym} className="hover:bg-slate-50/60 dark:hover:bg-[#151924]/60">
                          <td className="py-2 px-2.5 font-bold text-slate-900 dark:text-white">{sym}</td>
                          <td className="py-2 px-2">
                            {sig ? (
                              <span
                                className={`font-bold ${
                                  sig.direction === 'BUY' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                                }`}
                              >
                                {sig.direction} @ {sig.entry.toFixed(cfg.digits)}
                              </span>
                            ) : (
                              <span className="text-slate-400">{analysis?.bias === 'WAITING' ? 'Scanning' : analysis?.bias || 'No Feed'}</span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-right tabular-nums text-slate-700 dark:text-slate-200">
                            {analysis ? `${score}` : '—'}
                          </td>
                          <td className={`py-2 px-2 tabular-nums ${gateClass}`}>{gateLabel}</td>
                          <td className="py-2 px-2.5 text-right">
                            <button
                              type="button"
                              disabled={!sig || sendingSymbol === sym}
                              onClick={() => analysis && handleSendPairSignal(analysis)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-sky-500/10 hover:bg-sky-500/20 text-sky-600 dark:text-sky-400 border border-sky-500/25 font-sans font-semibold disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                            >
                              <Send className="w-2.5 h-2.5" />
                              <span>{sendingSymbol === sym ? '...' : 'Send'}</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Delivery Log */}
              <div className="border border-slate-200 dark:border-[#2b3b59] rounded-lg overflow-hidden flex flex-col">
                <div className="px-2.5 py-1.5 ws-subtle border-b border-slate-200 dark:border-[#2b3b59] text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Delivery Activity ({webhook.deliveryLog.length})
                </div>
                <div className="divide-y divide-slate-100 dark:divide-[#2b3b59] max-h-44 overflow-y-auto">
                  {webhook.deliveryLog.length === 0 ? (
                    <div className="p-4 text-center text-[11px] text-slate-400">
                      No dispatches recorded yet. Use Test Connection or Send on a live setup.
                    </div>
                  ) : (
                    webhook.deliveryLog.map((entry) => (
                      <div key={entry.id} className="px-2.5 py-2 text-[11px] space-y-0.5">
                        <div className="flex items-center justify-between gap-2 font-mono">
                          <span className={`font-bold ${entry.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
                            {entry.ok ? 'SENT' : 'FAILED'} · {entry.symbol}
                          </span>
                          <span className="text-[10px] text-slate-400 tabular-nums">
                            {new Date(entry.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <div className="text-slate-600 dark:text-slate-300 truncate">{entry.detail}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 4. HEALTH & METRICS */}
        {activeTab === 'health' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <span className="text-[11px] text-slate-400 block">Win Rate</span>
                <span className="font-mono font-bold text-sm text-slate-900 dark:text-white tabular-nums">
                  {metrics.winRate !== null ? `${metrics.winRate.toFixed(1)}%` : 'No Closed Trades'}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-slate-400 block">Profit Factor</span>
                <span className="font-mono font-bold text-sm text-slate-900 dark:text-white tabular-nums">
                  {metrics.profitFactor !== null ? metrics.profitFactor.toFixed(2) : '—'}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-slate-400 block">Portfolio Stop Risk</span>
                <span className="font-mono font-bold text-sm text-slate-900 dark:text-white tabular-nums">
                  ${portfolioRisk.riskUsd.toFixed(2)} / ${portfolioRiskLimit.toFixed(2)}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-slate-400 block">Feed Latency</span>
                <span className={`font-mono font-bold text-sm tabular-nums ${feedHealthy ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'}`}>
                  {quoteAge !== null ? `${(quoteAge / 1000).toFixed(1)}s` : '—'} · {feedHealthy ? 'FRESH' : 'CHECK FEED'}
                </span>
              </div>
            </div>

            {/* Strategy & Timeframe Attribution Matrix */}
            <div className="pt-3 border-t border-slate-200 dark:border-[#2b3b59]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Strategy &amp; Timeframe Attribution
                </span>
                <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                  {closedTrades.length} Trades · {validations.length} Validations
                </span>
              </div>

              {strategyAttribution.byStrategy.every((r) => r.trades === 0 && r.signalSamples === 0) &&
              strategyAttribution.byTimeframe.every((r) => r.trades === 0 && r.signalSamples === 0) ? (
                <div className="py-2 text-xs text-slate-400">
                  No attributed trades or tracked signals for this account yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {[
                    { title: 'By Strategy', rows: strategyAttribution.byStrategy },
                    { title: 'By Timeframe', rows: strategyAttribution.byTimeframe },
                  ].map((panel) => (
                    <div key={panel.title} className="overflow-x-auto border border-slate-200 dark:border-[#2b3b59] rounded-lg">
                      <div className="px-2.5 py-1.5 ws-subtle border-b border-slate-200 dark:border-[#2b3b59] text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                        {panel.title}
                      </div>
                      <table className="w-full text-left border-collapse text-[11px]">
                        <thead>
                          <tr className="ws-subtle border-b border-slate-200 dark:border-[#2b3b59] text-slate-500 dark:text-slate-400 font-semibold">
                            <th className="py-1.5 px-2.5">Segment</th>
                            <th className="py-1.5 px-2 text-right">Trades</th>
                            <th className="py-1.5 px-2 text-right">Win %</th>
                            <th className="py-1.5 px-2 text-right">PF</th>
                            <th className="py-1.5 px-2 text-right">Sig Win %</th>
                            <th className="py-1.5 px-2.5 text-right">Net P&amp;L</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-[#2b3b59] font-mono">
                          {panel.rows.map((row) => (
                            <tr key={`${row.group}:${row.key}`} className="hover:bg-slate-50/60 dark:hover:bg-[#151924]/60">
                              <td className="py-1.5 px-2.5 font-sans font-semibold text-slate-900 dark:text-white">
                                {row.key}
                              </td>
                              <td className="py-1.5 px-2 text-right tabular-nums text-slate-700 dark:text-slate-300">
                                {row.trades}
                              </td>
                              <td className="py-1.5 px-2 text-right tabular-nums text-slate-700 dark:text-slate-300">
                                {row.winRate !== null ? `${row.winRate.toFixed(1)}%` : '—'}
                              </td>
                              <td className="py-1.5 px-2 text-right tabular-nums text-slate-700 dark:text-slate-300">
                                {row.profitFactor !== null ? row.profitFactor.toFixed(2) : '—'}
                              </td>
                              <td className="py-1.5 px-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                                {row.signalWinRate !== null
                                  ? `${row.signalWinRate.toFixed(0)}% (${row.signalSamples})`
                                  : row.signalSamples > 0
                                    ? `— (${row.signalSamples})`
                                    : '—'}
                              </td>
                              <td
                                className={`py-1.5 px-2.5 text-right font-bold tabular-nums ${
                                  row.netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                                }`}
                              >
                                {row.netProfit >= 0 ? '+' : ''}${row.netProfit.toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
});
