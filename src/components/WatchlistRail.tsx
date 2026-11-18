import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Server,
  Send,
  Sparkles,
} from 'lucide-react';
import type { PairAnalysis } from '../engine/multiPairScanner';
import { SUPPORTED_SYMBOLS, getInstrumentConfig, type SupportedSymbol } from '../engine/instrumentConfig';
import { useEngine, useTicker, useWebhookState } from '../hooks/useTradingStore';
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

function formatPrice(value: number | null | undefined, digits: number): string {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value.toFixed(digits)
    : 'Unavailable';
}

function shortText(value: string, maxLength = 96): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1).trimEnd()}…` : value;
}

export type ScannerCardStatus = 'READY' | 'WAITING' | 'BLOCKED' | 'STALE' | 'DISCONNECTED';

export function getScannerCardStatus(
  item: Pick<PairAnalysis, 'status' | 'safeLotSize' | 'signal' | 'expiryTimestamp'> | null,
  connected: boolean,
  quoteStale: boolean,
  now = Date.now()
): ScannerCardStatus {
  if (!connected) return 'DISCONNECTED';
  if (!item) return 'WAITING';
  if (quoteStale || Boolean(item.expiryTimestamp && item.expiryTimestamp <= now)) return 'STALE';
  if (item.status === 'BLOCKED' || (item.status === 'READY' && !(item.safeLotSize && item.safeLotSize > 0))) {
    return 'BLOCKED';
  }
  return item.status === 'READY' && item.signal ? 'READY' : 'WAITING';
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{children}</h3>;
}

function DetailValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 truncate font-mono text-xs font-medium text-slate-800 dark:text-slate-100">{value}</dd>
    </div>
  );
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
  const ticker = useTicker();
  const webhook = useWebhookState();
  const autoFocus = engine.autoSelectBestScenario ?? true;
  const mt5Connected = Boolean(engine.mt5Account?.connected);

  const [detailsSymbol, setDetailsSymbol] = useState<SupportedSymbol | null>(null);
  const [sendingSym, setSendingSym] = useState<string | null>(null);
  const [tgToast, setTgToast] = useState<{ sym: string; ok: boolean; msg: string } | null>(null);
  const [, setFreshnessClock] = useState(0);

  const analyzedMap = new Map(scannerAnalyses.map((item) => [item.symbol, item]));
  const readyCount = scannerAnalyses.filter(
    (a) => a.status === 'READY' && typeof a.safeLotSize === 'number' && a.safeLotSize > 0
  ).length;

  useEffect(() => {
    const updatedAt = ticker.quoteUpdatedAt;
    if (!updatedAt || updatedAt <= 0) return;
    const timeout = window.setTimeout(
      () => setFreshnessClock(Date.now()),
      Math.max(0, updatedAt + 45_000 - Date.now())
    );
    return () => window.clearTimeout(timeout);
  }, [ticker.quoteUpdatedAt, ticker.symbol]);

  const now = Date.now();

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

        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5 items-stretch">
        {SUPPORTED_SYMBOLS.map((sym) => {
          const item = analyzedMap.get(sym);
          const cfg = getInstrumentConfig(sym);
          const isActive = sym === activeSymbol;
          const hasSafeLot = typeof item?.safeLotSize === 'number' && item.safeLotSize > 0;
          const expired = Boolean(item?.expiryTimestamp && item.expiryTimestamp <= now);
          const activeQuoteStale = Boolean(
            isActive &&
            ticker.quoteUpdatedAt &&
            ticker.quoteUpdatedAt > 0 &&
            now - ticker.quoteUpdatedAt > 45_000
          );
          const state = getScannerCardStatus(item ?? null, mt5Connected, activeQuoteStale, now);
          const stateTone = state === 'READY'
            ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/10'
            : state === 'BLOCKED'
              ? 'text-rose-700 dark:text-rose-300 bg-rose-500/10'
              : state === 'STALE'
                ? 'text-amber-700 dark:text-amber-300 bg-amber-500/10'
                : 'text-slate-600 dark:text-slate-300 bg-slate-500/10';
          const direction = item?.bias ?? 'WAITING';
          const shortReason = !mt5Connected
            ? 'Waiting for MT5 connection.'
            : !item
              ? `Waiting for ${sym} broker quotes and candles.`
              : activeQuoteStale
                ? 'Broker quote is stale; wait for a fresh MT5 update.'
                : expired
                  ? 'Signal expired; waiting for a fresh setup.'
                  : item.rejectionReason
                    ? formatHoldReason(item.rejectionReason) || 'Trade blocked by a safety check.'
                    : item.signal?.humanExplanation?.simpleSummary || 'No confirmed setup; monitoring the market.';
          const isTradeable = state === 'READY' && Boolean(item?.signal);
          const isShowingDetails = detailsSymbol === sym;

          return (
            <article
              key={sym}
              className={`ws-surface min-h-[148px] border rounded-xl p-3 flex flex-col justify-between gap-2 transition-colors ${
                isActive
                  ? 'border-sky-500/70 dark:border-sky-400/70 ring-1 ring-sky-500/20'
                  : 'hover:border-slate-400 dark:hover:border-[#3b527a]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <button
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => onSelectSymbol(sym)}
                    className="font-mono text-sm font-bold tracking-tight text-slate-950 dark:text-white hover:text-sky-700 dark:hover:text-sky-300"
                  >
                    {sym}
                  </button>
                  <p className="truncate text-[10px] text-slate-500 dark:text-slate-400">{cfg.displayName}</p>
                </div>
                <span aria-label={`${state} status`} className={`shrink-0 rounded px-2 py-1 text-[9px] font-bold tracking-wide ${stateTone}`}>{state}</span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className={`text-[11px] font-semibold ${direction === 'BUY'
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : direction === 'SELL'
                    ? 'text-rose-700 dark:text-rose-300'
                    : 'text-slate-500 dark:text-slate-400'}`}>
                  {direction}
                </span>
                <span title="Technical confluence score; not win probability" className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                  Score <strong className="text-slate-800 dark:text-slate-200">{item ? item.confluenceScore : '—'}</strong>
                </span>
                <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                  Spread {item && Number.isFinite(item.spreadPoints) ? `${item.spreadPoints} pts` : 'Unavailable'}
                </span>
              </div>

              <p className="min-h-8 text-[11px] leading-4 text-slate-600 dark:text-slate-300">
                {shortText(shortReason)}
              </p>

              <div className="flex items-center justify-between border-t border-slate-200/70 pt-2 dark:border-[#2b3b59]">
                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                  Primary {item?.signal?.timeframe ?? '—'}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDetailsSymbol(isShowingDetails ? null : sym)}
                    aria-expanded={isShowingDetails}
                    aria-controls={`scanner-details-${sym}`}
                    aria-label={`${isShowingDetails ? 'Hide' : 'Open'} ${sym} details`}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold text-sky-700 hover:bg-sky-500/10 dark:text-sky-300"
                  >
                    {isShowingDetails ? 'Hide details' : 'Details'}
                    {isShowingDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectSymbol(sym)}
                    aria-label={`Select ${sym} for chart`}
                    className="rounded-md border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-[#34445f] dark:text-slate-200 dark:hover:bg-[#1b2130]"
                  >
                    {isActive ? 'Chart' : 'Select'}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {detailsSymbol && (() => {
        const sym = detailsSymbol;
        const item = analyzedMap.get(sym);
        const cfg = getInstrumentConfig(sym);
        const signal = item?.signal;
        const expired = Boolean(item?.expiryTimestamp && item.expiryTimestamp <= now);
        const hasSafeLot = typeof item?.safeLotSize === 'number' && item.safeLotSize > 0;
        const activeQuoteAgeMs = sym === ticker.symbol && ticker.quoteUpdatedAt
          ? Math.max(0, now - ticker.quoteUpdatedAt)
          : null;
        const quoteFreshness = !mt5Connected
          ? 'Disconnected'
          : activeQuoteAgeMs === null
            ? 'Timestamp unavailable'
            : activeQuoteAgeMs > 45_000
              ? `Stale · ${Math.round(activeQuoteAgeMs / 1000)}s`
              : `Fresh · ${Math.round(activeQuoteAgeMs / 1000)}s`;
        const canExecute = mt5Connected && !expired && item?.status === 'READY' &&
          item.spreadAcceptable &&
          typeof item.safeLotSize === 'number' && item.safeLotSize > 0 && Boolean(signal);
        const scoreBreakdown = item ? Object.entries(item.scoreBreakdown)
          .filter(([, value]) => typeof value === 'number')
          .map(([name, value]) => [name, value as number] as const) : [];
        return (
          <section
            id={`scanner-details-${sym}`}
            aria-label={`${sym} trade details`}
            className="ws-surface space-y-3 rounded-xl border p-3 sm:p-4"
          >
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2 dark:border-[#2b3b59]">
              <div>
                <h3 className="font-mono text-sm font-bold text-slate-950 dark:text-white">{sym} · Trade Inspector</h3>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                  {item ? `${item.displayName} · ${item.status}` : mt5Connected ? 'Waiting for broker analysis' : 'Waiting for MT5'}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onSelectSymbol(sym)}
                  className="rounded-md border px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 dark:border-[#34445f] dark:text-slate-200"
                >
                  Select for chart
                </button>
                <button
                  type="button"
                  onClick={() => setDetailsSymbol(null)}
                  aria-label={`Close ${sym} details`}
                  className="rounded-md px-2.5 py-1.5 text-[11px] text-slate-500 hover:bg-slate-100 dark:hover:bg-[#1b2130]"
                >
                  Close
                </button>
              </div>
            </header>

            {!item ? (
              <p className="rounded-lg bg-slate-500/5 p-3 text-xs text-slate-600 dark:text-slate-300">
                {mt5Connected ? `Broker analysis for ${sym} is unavailable while quotes and closed candles synchronize.` : 'Waiting for MT5 connection. No live market values are shown.'}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <section className="space-y-2 rounded-lg border border-slate-200/80 p-3 dark:border-[#2b3b59]">
                  <SectionHeading>1. Trade Plan</SectionHeading>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                    <DetailValue label="Direction / setup" value={`${item.bias} · ${signal?.strategy ?? 'No active setup'}`} />
                    <DetailValue label="Primary timeframe" value={signal?.timeframe ?? 'Unavailable'} />
                    <DetailValue label="Entry type" value={signal?.executionMode ?? 'Unavailable'} />
                    <DetailValue label="Proposed entry" value={signal ? formatPrice(signal.entry, cfg.digits) : 'Unavailable'} />
                    <DetailValue label="Stop loss" value={signal ? formatPrice(signal.sl, cfg.digits) : 'Unavailable'} />
                    <DetailValue label="Take profit" value={signal ? formatPrice(signal.tp, cfg.digits) : 'Unavailable'} />
                    <DetailValue label="Risk / reward" value={signal ? `1:${item.riskRewardRatio.toFixed(1)}` : 'Unavailable'} />
                    <DetailValue label="Expiry" value={item.expiryTimestamp ? new Date(item.expiryTimestamp).toLocaleTimeString() : 'Unavailable'} />
                    <DetailValue label="Last MT5 bid / ask" value={`${formatPrice(item.bid, cfg.digits)} / ${formatPrice(item.ask, cfg.digits)}`} />
                    <DetailValue label="Quote freshness" value={quoteFreshness} />
                  </dl>
                  <p className="text-[11px] leading-4 text-slate-600 dark:text-slate-300">
                    {signal?.humanExplanation?.simpleSummary || formatHoldReason(item.rejectionReason) || 'No active setup.'}
                  </p>
                </section>

                <section className="space-y-2 rounded-lg border border-slate-200/80 p-3 dark:border-[#2b3b59]">
                  <SectionHeading>2. Market Structure</SectionHeading>
                  <div className="grid grid-cols-4 gap-1 text-center">
                    {([['H1', item.h1Trend], ['M15', item.m15Trend], ['M5', item.m5Trend], ['M1', item.m1Trend]] as const).map(([timeframe, trend]) => (
                      <div key={timeframe} className="rounded bg-slate-500/5 py-1">
                        <span className="block text-[9px] text-slate-400">{timeframe}</span>
                        <span className={`text-[10px] font-semibold ${trendColor(trend)}`}>{trendLabel(trend)}</span>
                      </div>
                    ))}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                    <DetailValue label="BOS" value={item.lastBOS ? `${item.lastBOS.direction} · ${formatPrice(item.lastBOS.price, cfg.digits)}` : 'None observed'} />
                    <DetailValue label="CHoCH" value={item.lastCHoCH ? `${item.lastCHoCH.direction} · ${formatPrice(item.lastCHoCH.price, cfg.digits)}` : 'None observed'} />
                    <DetailValue label="Dealing range" value={`${formatPrice(item.dealingRange.low, cfg.digits)} – ${formatPrice(item.dealingRange.high, cfg.digits)}`} />
                    <DetailValue label="Range position" value={`${item.premiumDiscountPct}% · ${item.premiumDiscountPct < 50 ? 'Discount' : 'Premium'}`} />
                    <DetailValue label="Liquidity sweep" value={item.liquidity.recentSweep ? `Swept ${item.liquidity.recentSweep}` : 'None observed'} />
                    <DetailValue label="BSL / SSL" value={`${item.liquidity.buySideLiquidity ? formatPrice(item.liquidity.buySideLiquidity, cfg.digits) : 'Unavailable'} / ${item.liquidity.sellSideLiquidity ? formatPrice(item.liquidity.sellSideLiquidity, cfg.digits) : 'Unavailable'}`} />
                  </dl>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {([
                      ['Order blocks', item.orderBlocks],
                      ['Fair value gaps', item.fvgs],
                    ] as const).map(([label, zones]) => (
                      <div key={label} className="min-w-0">
                        <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">{label} ({zones.length})</p>
                        {zones.length ? (
                          <ul className="max-h-20 space-y-0.5 overflow-y-auto text-[10px] font-mono text-slate-700 dark:text-slate-200">
                            {zones.map((zone, index) => <li key={`${zone.born}-${index}`}>{zone.bullish ? 'Bull' : 'Bear'} · {formatPrice(zone.bottom, cfg.digits)}–{formatPrice(zone.top, cfg.digits)}{zone.filled ? ' · filled' : ''}</li>)}
                          </ul>
                        ) : <p className="text-[10px] text-slate-400">Unavailable</p>}
                      </div>
                    ))}
                  </div>
                </section>

                <section className="space-y-2 rounded-lg border border-slate-200/80 p-3 dark:border-[#2b3b59]">
                  <SectionHeading>3. Confirmations</SectionHeading>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                    <DetailValue label="ATR" value={item.atr > 0 ? `${item.atr.toFixed(cfg.digits)} (${(item.atr / cfg.pipSize).toFixed(1)} pips)` : 'Unavailable'} />
                    <DetailValue label="Volatility" value={item.volatility} />
                    <DetailValue label="Tick RVOL" value={item.volumeMetrics?.available ? `${item.volumeMetrics.rvol.toFixed(2)}×` : 'Unavailable'} />
                    <DetailValue label="Momentum score" value={`${item.scoreBreakdown.momentumConfirm}/8`} />
                    <DetailValue label="Market session" value={`${item.sessionName}${item.isPreferredSession ? ' · preferred' : ''}`} />
                    <DetailValue label="News restriction" value={item.newsStatus || 'Unavailable'} />
                    <DetailValue label="Macro / sentiment" value={`${item.macroBias ?? 'Unavailable'} / ${item.sentimentBias ?? 'Unavailable'}`} />
                    <DetailValue label="Candlestick" value={item.candlestickPattern?.name ?? 'None confirmed'} />
                  </dl>
                  <div>
                    <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">Confluence components · score, not win probability</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {scoreBreakdown.map(([name, value]) => (
                        <span key={name} className="rounded bg-slate-500/5 px-1.5 py-1 text-[9px] text-slate-600 dark:text-slate-300">
                          {name.replace(/([A-Z])/g, ' $1')}: {value}
                        </span>
                      ))}
                    </div>
                  </div>
                </section>

                <section className="space-y-2 rounded-lg border border-slate-200/80 p-3 dark:border-[#2b3b59]">
                  <SectionHeading>4. Risk &amp; Execution</SectionHeading>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                    <DetailValue label="Readiness" value={`${item.status}${item.status === 'READY' && !hasSafeLot ? ' · sizing blocked' : ''}`} />
                    <DetailValue label="Broker specification" value={item.symbolSpec ? 'Verified' : 'Unavailable'} />
                    <DetailValue label="Verified lot size" value={hasSafeLot ? `${item.safeLotSize!.toFixed(2)} lots` : 'Unavailable'} />
                    <DetailValue label="Estimated stop risk" value={item.estimatedRiskUsd !== null ? `$${item.estimatedRiskUsd.toFixed(2)}` : 'Unavailable'} />
                    <DetailValue label="Live spread / limit" value={`${Number.isFinite(item.spreadPoints) ? `${item.spreadPoints} pts` : 'Unavailable'} / ${cfg.maxSpreadPoints} pts`} />
                    <DetailValue label="Broker trading" value={item.symbolSpec?.tradeDisabled ? 'Disabled' : item.symbolSpec ? 'Available' : 'Unavailable'} />
                  </dl>
                  {(item.rejectionReason || !item.spreadAcceptable) && (
                    <p className="rounded bg-rose-500/5 p-2 text-[11px] text-rose-700 dark:text-rose-300">
                      {formatHoldReason(item.rejectionReason) || 'Spread exceeds the instrument limit.'}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 border-t border-slate-200/70 pt-2 dark:border-[#2b3b59]">
                    {canExecute && onExecuteTrade && (
                      <button
                        type="button"
                        onClick={() => onExecuteTrade(item)}
                        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[11px] font-semibold text-white ${item.bias === 'SELL' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                      >
                        Execute {item.bias} · {item.safeLotSize!.toFixed(2)}L <ArrowRight className="h-3 w-3" />
                      </button>
                    )}
                    {signal && (
                      <button
                        type="button"
                        disabled={sendingSym === sym}
                        onClick={(event) => void handleBroadcastPair(event, item)}
                        title={webhook.hasValidDestination ? `Send ${sym} signal to Telegram` : 'Configure Telegram Alerts'}
                        className="inline-flex items-center gap-1 rounded-md border px-2.5 py-2 text-[11px] text-sky-700 dark:border-[#34445f] dark:text-sky-300 disabled:opacity-50"
                      >
                        <Send className="h-3 w-3" /> Telegram
                      </button>
                    )}
                    {tgToast?.sym === sym && <span role="status" className={`text-[10px] ${tgToast.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{tgToast.msg}</span>}
                  </div>
                </section>
              </div>
            )}
          </section>
        );
      })()}
    </section>
  );
});
