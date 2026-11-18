/**
 * SignalEngineCard.tsx - Refined Minimalist SMC Signal & Execution Engine
 * Redesigned to eliminate clutter, crowded text, and visual fatigue:
 * - Generous breathing room, modest typography
 * - Prominent Direction, Confluence Score & Key Levels
 * - Clean entry, SL, TP figures
 * - Uncrowded lot controls and high-contrast execution button
 */

import React, { useState, useMemo, useEffect } from 'react';
import { useMarket, useTicker, useEngine, useWebhookState } from '../hooks/useTradingStore';
import { tradingEngine } from '../engine/tradingEngine';
import {
  ArrowRight,
  Zap,
  Copy,
  Check,
  Minus,
  Plus,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Send,
} from 'lucide-react';
import { Signal, TradeDirection } from '../types/smc';
import { buildSignalRationale } from '../engine/tradeJournal';
import { getInstrumentConfig } from '../engine/instrumentConfig';
import type { SupportedSymbol } from '../engine/instrumentConfig';
import { signalAudioNotifier } from '../utils/audioNotification';
import { dispatchLiveSignalAlert } from '../utils/webhookNotifier';

interface SignalEngineCardProps {
  onExecuteSignal?: (customVolume?: number, positionCount?: number, signal?: Signal) => void | Promise<void>;
  onOpenWebhook?: () => void;
}

const LOT_PRESETS = [0.01, 0.02, 0.05, 0.10];

function formatSignalCountdown(seconds?: number): string {
  if (seconds === undefined || seconds <= 0) return '—';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export const SignalEngineCard: React.FC<SignalEngineCardProps> = React.memo(({ onExecuteSignal, onOpenWebhook }) => {
  const market = useMarket();
  const ticker = useTicker();
  const engine = useEngine();
  const webhook = useWebhookState();

  // Filter to only show READY signals (executable)
  const readySignals = useMemo(() => {
    return market.signals.filter((signal) => {
      const analysis = market.scannerAnalyses?.find(
        (candidate) =>
          candidate.symbol === ticker.symbol &&
          candidate.signal?.timestamp === signal.timestamp
      );
      return !analysis || analysis.status === 'READY';
    });
  }, [market.signals, market.scannerAnalyses, ticker.symbol]);

  // Execution parameters
  const [lotSize, setLotSize] = useState<number>(0.01);
  const positionCount = 1;
  const [copied, setCopied] = useState(false);
  const [executedFeedback, setExecutedFeedback] = useState<string | null>(null);
  const [tgFeedback, setTgFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);

  const executionMode = engine.executionMode ?? 'MARKET';

  const isBrokerTradeDisabled =
    Boolean(market.symbolSpec?.tradeDisabled) ||
    (market.lastExecutionError?.symbol === ticker.symbol &&
      Boolean(market.lastExecutionError?.isTradeDisabled));

  const selectedSignal = readySignals.find(
    (signal) => `${signal.strategy}:${signal.direction}:${signal.timeframe}:${signal.timestamp}` === selectedSignalId
  );
  const rawSig = selectedSignal ?? (readySignals.length > 0 ? readySignals[0] : null);
  const scannerAnalysis = rawSig
    ? market.scannerAnalyses?.find(
        (analysis) =>
          analysis.symbol === ticker.symbol &&
          analysis.signal?.timestamp === rawSig.timestamp
      )
    : undefined;
  const scannerBlockReason =
    scannerAnalysis && scannerAnalysis.status !== 'READY'
      ? scannerAnalysis.rejectionReason ||
        `Confluence ${scannerAnalysis.confluenceScore}/100 is below the setup threshold.`
      : null;
  const maxSpreadPoints = tradingEngine.getMaxSpreadPoints();
  const isWideSpread = ticker.spread > maxSpreadPoints;
  const quoteAgeMs = ticker.quoteUpdatedAt && ticker.quoteUpdatedAt > 0
    ? Math.max(0, Date.now() - ticker.quoteUpdatedAt)
    : null;
  const quoteUnavailable = !ticker.marketDataAvailable || quoteAgeMs === null;
  const quoteStale = quoteAgeMs !== null && quoteAgeMs > 45_000;
  const [, setFreshnessRevision] = useState(0);
  useEffect(() => {
    const updatedAt = ticker.quoteUpdatedAt;
    if (!updatedAt || updatedAt <= 0) return;
    const timeout = window.setTimeout(
      () => setFreshnessRevision((revision) => revision + 1),
      Math.max(0, updatedAt + 45_000 - Date.now())
    );
    return () => window.clearTimeout(timeout);
  }, [ticker.quoteUpdatedAt]);

  const activeDirection: TradeDirection = rawSig?.direction || (market.bias === 'bearish' ? 'SELL' : 'BUY');
  const isBull = activeDirection === 'BUY';
  const instrumentConfig = getInstrumentConfig(ticker.symbol);

  const currentSpot = activeDirection === 'BUY' ? ticker.ask : ticker.bid;
  const entryPrice = currentSpot;
  const signalEntry = rawSig?.entry ?? null;
  const otePrice =
    rawSig?.optimalTradeEntry &&
    Math.abs(rawSig.optimalTradeEntry - rawSig.entry) > instrumentConfig.pointSize * 5
      ? rawSig.optimalTradeEntry
      : null;
  const riskLimitedLotSize = rawSig ? tradingEngine.getRiskBasedVolume(rawSig.sl, lotSize, rawSig.direction) : null;
  const sizingInfo = rawSig
    ? tradingEngine.getRiskSizingInfo(rawSig.sl, rawSig.direction, ticker.symbol as SupportedSymbol)
    : null;
  const isAdaptiveMicroFloor = Boolean(
    sizingInfo &&
    sizingInfo.safeVolume === sizingInfo.minimumLot &&
    sizingInfo.minimumLotRisk > sizingInfo.riskBudget
  );
  const hasSafeLot = typeof riskLimitedLotSize === 'number' && riskLimitedLotSize > 0;
  const readiness = quoteUnavailable
    ? 'DISCONNECTED'
    : quoteStale
      ? 'STALE'
      : isBrokerTradeDisabled || scannerBlockReason || isWideSpread || Boolean(rawSig && !hasSafeLot)
        ? 'BLOCKED'
        : rawSig
          ? 'READY'
          : 'WAITING';
  const slPrice = rawSig?.sl ?? null;
  const tpPrice = rawSig?.tp ?? null;
  const riskPts = rawSig ? Math.abs(entryPrice - rawSig.sl) : 0;
  const rewardPts = rawSig ? Math.abs(rawSig.tp - entryPrice) : 0;
  const riskPips = riskPts / instrumentConfig.pipSize;
  const rewardPips = rewardPts / instrumentConfig.pipSize;

  const handleSendTelegram = async () => {
    if (!webhook.hasValidDestination) {
      onOpenWebhook?.();
      setTgFeedback({ ok: false, text: 'Configure Telegram in Alerts' });
      setTimeout(() => setTgFeedback(null), 3000);
      return;
    }
    if (!rawSig) return;
    try {
      const res = await dispatchLiveSignalAlert({
        symbol: ticker.symbol as SupportedSymbol,
        direction: rawSig.direction,
        timeframe: rawSig.timeframe,
        strategy: rawSig.strategy || 'SMC Setup',
        entry: rawSig.entry,
        sl: rawSig.sl,
        tp: rawSig.tp,
        confluenceScore: rawSig.score,
        lotSize: riskLimitedLotSize ?? lotSize,
        force: true,
      });
      if (res.ok) {
        setTgFeedback({ ok: true, text: 'Sent to TG' });
      } else {
        setTgFeedback({ ok: false, text: res.error || 'Failed to send' });
      }
    } catch (e: unknown) {
      setTgFeedback({ ok: false, text: e instanceof Error ? e.message : 'Error' });
    }
    setTimeout(() => setTgFeedback(null), 3000);
  };

  const tradeMetrics = useMemo(() => {
    const totalLots = Number(((riskLimitedLotSize ?? lotSize) * positionCount).toFixed(2));
    const spec = market.symbolSpec;
    let riskDollar: number | null = null;
    let rewardDollar: number | null = null;

    if (
      spec &&
      Number.isFinite(spec.tickSize) &&
      spec.tickSize > 0 &&
      Number.isFinite(spec.tickValue) &&
      spec.tickValue > 0 &&
      totalLots > 0
    ) {
      riskDollar = Number((riskPts / spec.tickSize * spec.tickValue * totalLots).toFixed(2));
      rewardDollar = Number((rewardPts / spec.tickSize * spec.tickValue * totalLots).toFixed(2));
    }

    const rrRatio = riskPts > 0 ? (rewardPts / riskPts).toFixed(1) : '—';

    return {
      totalLots,
      riskDollar,
      rewardDollar,
      rrRatio,
    };
  }, [riskPts, rewardPts, lotSize, positionCount, riskLimitedLotSize, market.symbolSpec, ticker.symbol, currentSpot, instrumentConfig]);

  const handleAdjustLot = (delta: number) => {
    setLotSize((prev) => {
      const next = Math.round((prev + delta) * 100) / 100;
      return Math.min(10.0, Math.max(0.01, next));
    });
  };

  const handleCopy = () => {
    if (!rawSig) return;
    const text = `${ticker.symbol} ${activeDirection} | Entry: ${rawSig.entry} | SL: ${rawSig.sl} | TP: ${rawSig.tp} | Vol: ${tradeMetrics.totalLots}L`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleExecute = async () => {
    if (isWideSpread || !rawSig || riskLimitedLotSize === null || riskLimitedLotSize <= 0) return;
    signalAudioNotifier.unlock();
    signalAudioNotifier.playTradeExecutionAlert(rawSig.direction);

    const safeLot = riskLimitedLotSize;
    if (onExecuteSignal) {
      await onExecuteSignal(safeLot, positionCount, rawSig);
    } else {
      const order = {
        direction: rawSig.direction,
        volume: safeLot,
        entry: rawSig.entry,
        sl: rawSig.sl,
        tp: rawSig.tp,
        comment: `user_${rawSig.direction.toLowerCase()}`,
      };
      if (positionCount > 1) {
        const result = tradingEngine.tradeMultiplePositions(positionCount, order);
        setExecutedFeedback(`Opened ${result.countOpened} orders`);
      } else {
        const result = tradingEngine.tradeSignal(order);
        setExecutedFeedback(result.ok ? `Order sent: ${safeLot.toFixed(2)} lots` : result.error || 'Order rejected');
      }
      setTimeout(() => setExecutedFeedback(null), 3500);
    }
  };

  return (
    <div className="ws-surface border rounded-xl overflow-hidden flex flex-col h-full text-xs">
      {/* 1. Header */}
      <div className="px-4 py-3 ws-subtle border-b flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-extrabold text-sm text-slate-950 dark:text-white tracking-tight">
              {ticker.symbol} Ticket
            </h2>
            <span className="font-mono text-[11px] font-bold text-slate-600 dark:text-slate-300 tabular-nums">
              {!ticker.marketDataAvailable || quoteAgeMs === null
                ? 'Spread unavailable'
                : quoteStale
                  ? `Stale · ${ticker.spread} PTS`
                  : `${ticker.spread} PTS`}
            </span>
          </div>
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mt-0.5">
            {rawSig
              ? `${rawSig.strategy || 'SMC Setup'} · ${rawSig.timeframe}`
              : quoteUnavailable
                ? 'Waiting for MT5 quote'
                : quoteStale
                  ? `Quote stale · ${Math.round(quoteAgeMs! / 1000)}s`
                  : 'Monitoring live broker quotes'}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {rawSig && (
            <span
              className="font-mono text-xs font-bold text-slate-900 dark:text-white tabular-nums mr-1"
              title="Rule-based market confluence score; not a win-probability estimate."
            >
              Confluence {rawSig.score.toFixed(1)}/100
            </span>
          )}
          <button
            type="button"
            onClick={handleCopy}
            title="Copy signal parameters"
            disabled={!rawSig}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-[#1b2130] transition-colors cursor-pointer disabled:opacity-40"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={handleSendTelegram}
            title={
              !webhook.hasValidDestination
                ? 'Configure Telegram Alerts'
                : rawSig
                  ? 'Dispatch live signal to Telegram'
                  : 'Telegram configured (waiting for confirmed setup)'
            }
            disabled={!rawSig && webhook.hasValidDestination}
            className="p-1.5 rounded-lg text-slate-400 hover:text-sky-500 dark:hover:text-sky-400 hover:bg-slate-200/60 dark:hover:bg-[#1b2130] transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1"
          >
            <Send
              className={`w-3.5 h-3.5 ${
                webhook.status === 'ACTIVE'
                  ? 'text-emerald-500'
                  : webhook.status === 'ERROR'
                    ? 'text-rose-500'
                    : 'text-sky-500'
              }`}
            />
            {tgFeedback && (
              <span
                className={`text-[11px] font-semibold ${
                  tgFeedback.ok ? 'text-emerald-500' : 'text-rose-500'
                }`}
              >
                {tgFeedback.text}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="p-4 flex-1 flex flex-col justify-between space-y-4">
        <div className="space-y-4">
          {/* Broker Trade Disabled Banner (Retcode 10017) */}
          {isBrokerTradeDisabled && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs">
              <div className="font-semibold flex items-center gap-1.5 mb-1">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                <span>Broker Trade Disabled ({ticker.symbol} · 10017)</span>
              </div>
              <p className="text-[11px] leading-relaxed">
                Execution is disabled for <strong>{ticker.symbol}</strong> on this account. Check its MT5 permissions; only use another supported symbol if your broker enables it.
              </p>
            </div>
          )}

          {/* Setup Selector (when multiple timeframe/strategy setups are ready) */}
          {readySignals.length > 1 && (
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              {readySignals.slice(0, 4).map((sigItem) => {
                const sigId = `${sigItem.strategy}:${sigItem.direction}:${sigItem.timeframe}:${sigItem.timestamp}`;
                const active =
                  rawSig &&
                  `${rawSig.strategy}:${rawSig.direction}:${rawSig.timeframe}:${rawSig.timestamp}` === sigId;
                return (
                  <button
                    key={sigId}
                    type="button"
                    onClick={() => setSelectedSignalId(sigId)}
                    className={`px-2 py-1 rounded-md text-[11px] font-mono font-semibold border whitespace-nowrap transition-colors cursor-pointer ${
                      active
                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950 border-slate-900 dark:border-slate-100'
                        : 'ws-subtle text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {sigItem.timeframe} · {sigItem.direction} · {sigItem.score.toFixed(1)}/100
                  </button>
                );
              })}
            </div>
          )}

          {/* 2. Direction & Rationale */}
          <div className="space-y-2 pb-3 border-b border-slate-200 dark:border-[#2b3b59]">
            <div className="flex items-center justify-between gap-2">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold ${
                      rawSig
                    ? isBull
                      ? 'bg-emerald-600 text-white'
                      : 'bg-rose-600 text-white'
                    : 'ws-subtle text-slate-500 dark:text-slate-400 border'
                }`}
              >
                {isBull ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                <span>{rawSig ? rawSig.direction : 'WAITING'}</span>
              </span>
              <span className={`rounded px-2 py-1 text-[9px] font-bold tracking-wide ${
                readiness === 'READY' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : readiness === 'BLOCKED' ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
                    : readiness === 'STALE' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                      : 'bg-slate-500/10 text-slate-600 dark:text-slate-300'
              }`}>
                {readiness}
              </span>

              {rawSig && rawSig.validitySeconds && rawSig.validitySeconds > 0 && (
                <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                  Window {formatSignalCountdown(rawSig.validitySeconds)}
                </span>
              )}
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {rawSig
                ? rawSig.humanExplanation?.simpleSummary || buildSignalRationale(rawSig)
                : 'Standing by for structural market break or liquidity sweep confirmation.'}
            </p>

            {scannerBlockReason && (
              <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                Hold: {scannerBlockReason}
              </p>
            )}
          </div>

          {/* 3. Level Triad (Clean Hairline Columns) */}
          <div className="grid grid-cols-3 divide-x divide-slate-200 dark:divide-[#2b3b59] pb-3 border-b border-slate-200 dark:border-[#2b3b59]">
            <div className="pr-2">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block">
                {otePrice !== null && executionMode === 'PULLBACK_LIMIT' ? 'OTE Limit' : 'Entry'}
              </span>
              <span className="font-mono text-sm font-extrabold text-slate-950 dark:text-white tabular-nums block mt-0.5">
                {otePrice !== null && executionMode === 'PULLBACK_LIMIT'
                  ? otePrice.toFixed(instrumentConfig.digits)
                  : signalEntry === null
                    ? '—'
                    : signalEntry.toFixed(instrumentConfig.digits)}
              </span>
              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5 tabular-nums">
                {otePrice !== null && executionMode !== 'PULLBACK_LIMIT'
                  ? `OTE ${otePrice.toFixed(instrumentConfig.digits)}`
                  : rawSig
                    ? `${rawSig.timeframe}${rawSig.regime ? ` · ${rawSig.regime}` : ''}`
                    : 'Pending'}
              </span>
            </div>

            <div className="px-2.5">
              <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 block">Stop Loss</span>
              <span className="font-mono text-sm font-extrabold text-rose-600 dark:text-rose-400 tabular-nums block mt-0.5">
                {slPrice === null ? '—' : slPrice.toFixed(instrumentConfig.digits)}
              </span>
              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums block mt-0.5">
                {rawSig
                  ? `-${riskPips.toFixed(1)}p · ${
                      tradeMetrics.riskDollar === null
                        ? 'risk unavailable'
                        : `-$${tradeMetrics.riskDollar} price-only`
                    }`
                  : 'Pending'}
              </span>
            </div>

            <div className="pl-2.5">
              <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 block">Take Profit</span>
              <span className="font-mono text-sm font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums block mt-0.5">
                {tpPrice === null ? '—' : tpPrice.toFixed(instrumentConfig.digits)}
              </span>
              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums block mt-0.5">
                {rawSig ? `+${rewardPips.toFixed(1)}p · +$${tradeMetrics.rewardDollar}` : 'Pending'}
              </span>
            </div>
          </div>

          {/* 4. Execution Mode, Lot Sizing & Risk Summary */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 dark:text-slate-400">Auto Fill Mode</span>
              <div className="inline-flex rounded-md border border-slate-200 dark:border-[#2b3b59] overflow-hidden">
                <button
                  type="button"
                  onClick={() => tradingEngine.setExecutionMode('MARKET')}
                  className={`px-2 py-0.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                    executionMode === 'MARKET'
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950'
                      : 'ws-subtle text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Market
                </button>
                <button
                  type="button"
                  onClick={() => tradingEngine.setExecutionMode('PULLBACK_LIMIT')}
                  className={`px-2 py-0.5 text-[11px] font-semibold transition-colors cursor-pointer border-l border-slate-200 dark:border-[#2b3b59] ${
                    executionMode === 'PULLBACK_LIMIT'
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950'
                      : 'ws-subtle text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  OTE Limit
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 dark:text-slate-400">Risk / Reward</span>
              <span className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                1:{tradeMetrics.rrRatio} · {riskLimitedLotSize && riskLimitedLotSize > 0 ? `${riskLimitedLotSize.toFixed(2)}L safe` : 'Sizing hold'}
              </span>
            </div>
            {isAdaptiveMicroFloor && sizingInfo && (
              <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                Minimum-lot risk ${sizingInfo.minimumLotRisk.toFixed(2)} exceeds the ${sizingInfo.riskBudget.toFixed(2)} budget; adaptive cap applies.
              </p>
            )}

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                {LOT_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setLotSize(preset)}
                    className={`px-2 py-1 rounded-md font-mono text-[11px] font-semibold border transition-colors cursor-pointer ${
                      lotSize === preset
                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950 border-slate-900 dark:border-slate-100'
                        : 'ws-subtle text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {preset.toFixed(2)}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 ws-subtle border rounded-lg px-1.5 py-0.5">
                <button
                  type="button"
                  onClick={() => handleAdjustLot(-0.01)}
                  aria-label="Decrease lot size"
                  className="p-1 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white cursor-pointer"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span className="font-mono font-bold tabular-nums w-11 text-center text-slate-900 dark:text-white text-xs">
                  {(riskLimitedLotSize ?? lotSize).toFixed(2)}
                </span>
                <button
                  type="button"
                  onClick={() => handleAdjustLot(0.01)}
                  aria-label="Increase lot size"
                  className="p-1 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 5. Execution CTA */}
        <div className="space-y-2 pt-2">
          {executedFeedback && (
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold text-center">
              ✓ {executedFeedback}
            </div>
          )}

          <button
            data-hotkey-execute="true"
            onClick={handleExecute}
            disabled={isBrokerTradeDisabled || isWideSpread || !rawSig || !sizingInfo || !hasSafeLot || Boolean(scannerBlockReason)}
            className={`w-full py-3 px-4 rounded-xl font-bold text-xs tracking-wide transition-colors flex items-center justify-center gap-2 cursor-pointer ${
              isBrokerTradeDisabled || isWideSpread || !rawSig || !sizingInfo || !hasSafeLot || Boolean(scannerBlockReason)
                ? 'ws-subtle text-slate-400 dark:text-slate-500 cursor-not-allowed border'
                : activeDirection === 'SELL'
                ? 'bg-rose-600 hover:bg-rose-700 text-white'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
            }`}
          >
            <span>
              {isBrokerTradeDisabled
                ? `Trading Disabled (${ticker.symbol})`
                : !rawSig && quoteUnavailable
                ? 'Waiting for MT5 Quote'
                : !rawSig && quoteStale
                ? 'Quote Stale — Waiting for Refresh'
                : !rawSig
                ? 'Waiting for Confirmed Setup'
                : isWideSpread
                ? `Spread Too Wide (${ticker.spread} pts)`
                : !hasSafeLot
                ? 'Risk Limit Exceeded'
                : scannerBlockReason
                ? 'Setup Held by Safety Filter'
                : `Execute ${activeDirection} ${(riskLimitedLotSize ?? lotSize).toFixed(2)}L @ ${entryPrice.toFixed(instrumentConfig.digits)}`}
            </span>
            <ArrowRight className="w-4 h-4 shrink-0" />
          </button>
        </div>
      </div>
    </div>
  );
});
