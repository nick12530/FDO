/**
 * SMCOverlayHUD.tsx - System-Synced SMC Levels & Position Dock
 * Renders cleanly below the TradingView canvas (zero overlap on chart candles or TV toolbars).
 * Every toggle in indicatorConfig strictly controls real system data readouts from tradingEngine.
 */

import React, { memo } from 'react';
import {
  useMarket,
  usePositions,
  useTicker,
  useScannerAnalyses,
} from '../hooks/useTradingStore';
import { tradingEngine } from '../engine/tradingEngine';
import { getInstrumentConfig } from '../engine/instrumentConfig';
import type { SMCIndicatorConfig } from '../types/smc';

interface SMCOverlayHUDProps {
  showIndicators: boolean;
  indicatorConfig: SMCIndicatorConfig;
}

export const SMCOverlayHUD: React.FC<SMCOverlayHUDProps> = memo(({
  showIndicators,
  indicatorConfig,
}) => {
  const market = useMarket();
  const positionsState = usePositions();
  const ticker = useTicker();
  const scannerAnalyses = useScannerAnalyses();

  if (!showIndicators) return null;

  const cfg = getInstrumentConfig(ticker.symbol);
  const digits = cfg.digits;
  const hasLiveBroker = Boolean(market.brokerMarketData && ticker.bid > 0);
  const analysis = scannerAnalyses.find((a) => a.symbol === ticker.symbol);

  const tfData = market.timeframeData?.[market.currentTimeframe];
  const zones = tfData?.zones?.length ? tfData.zones : market.zones || [];
  const demandOB = zones.find((z) => z.kind === 'OB' && z.bullish && !z.filled);
  const supplyOB = zones.find((z) => z.kind === 'OB' && !z.bullish && !z.filled);
  const bullFvg = zones.find((z) => z.kind === 'FVG' && z.bullish && !z.filled);
  const bearFvg = zones.find((z) => z.kind === 'FVG' && !z.bullish && !z.filled);

  const latestStructure =
    tfData?.choch ||
    tfData?.bos ||
    market.choch ||
    market.bos ||
    analysis?.lastCHoCH ||
    analysis?.lastBOS ||
    null;

  const eqPrice =
    tfData?.dealing_range?.equilibrium ??
    market.dealing_range?.equilibrium ??
    (hasLiveBroker && ticker.high24h > 0 && ticker.low24h > 0
      ? (ticker.high24h + ticker.low24h) / 2
      : null);

  const activePositions = positionsState.positions;
  const selectedTicket = positionsState.selectedTicket ?? activePositions[0]?.ticket;

  return (
    <div className="px-3.5 py-2.5 ws-subtle border-t flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[11px] font-mono">
      {/* System-Synced SMC Readouts */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* Broker Live Quote & Range Zone */}
        <span className="inline-flex items-center gap-1.5 font-bold text-slate-900 dark:text-slate-100">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              hasLiveBroker ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-600'
            }`}
          />
          <span>{hasLiveBroker ? `MT5 Spot ${ticker.bid.toFixed(digits)}` : 'MT5 Feed Offline'}</span>
          {hasLiveBroker && eqPrice !== null && (
            <span className={ticker.bid >= eqPrice ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>
              ({ticker.bid >= eqPrice ? 'Premium' : 'Discount'} · EQ {eqPrice.toFixed(digits)})
            </span>
          )}
        </span>

        {/* Structure Layer (BOS / CHoCH + HTF Trend) */}
        {indicatorConfig.structure && (
          <span className="text-slate-600 dark:text-slate-300">
            <strong className="text-slate-800 dark:text-white">Struct:</strong>{' '}
            {latestStructure ? (
              <span
                className={
                  latestStructure.direction === 'bullish'
                    ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                    : 'text-rose-600 dark:text-rose-400 font-bold'
                }
              >
                {latestStructure.kind} {latestStructure.direction === 'bullish' ? 'Bull' : 'Bear'}
              </span>
            ) : analysis ? (
              <span>
                H1 {analysis.h1Trend} / M15 {analysis.m15Trend}
              </span>
            ) : (
              <span className="text-slate-400">Awaiting candles</span>
            )}
          </span>
        )}

        {/* Order Blocks Layer */}
        {indicatorConfig.orderBlocks && (
          <span className="text-slate-600 dark:text-slate-300">
            <strong className="text-slate-800 dark:text-white">OB:</strong>{' '}
            {demandOB || supplyOB ? (
              <>
                {demandOB && (
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                    +OB {demandOB.bottom.toFixed(digits)}
                  </span>
                )}
                {demandOB && supplyOB && <span className="mx-1 text-slate-400">/</span>}
                {supplyOB && (
                  <span className="text-rose-600 dark:text-rose-400 font-bold">
                    -OB {supplyOB.top.toFixed(digits)}
                  </span>
                )}
              </>
            ) : (
              <span className="text-slate-400">None active</span>
            )}
          </span>
        )}

        {/* Fair Value Gaps Layer */}
        {indicatorConfig.fairValueGaps && (
          <span className="text-slate-600 dark:text-slate-300">
            <strong className="text-slate-800 dark:text-white">FVG:</strong>{' '}
            {bullFvg || bearFvg ? (
              <span className="text-sky-600 dark:text-sky-400 font-bold">
                {(bullFvg || bearFvg)!.bottom.toFixed(digits)}–{(bullFvg || bearFvg)!.top.toFixed(digits)}
              </span>
            ) : (
              <span className="text-slate-400">Balanced</span>
            )}
          </span>
        )}

        {/* Active Signal POI Levels */}
        {indicatorConfig.signals && market.signal && (
          <span className="text-slate-700 dark:text-slate-200 font-bold">
            <span className={market.signal.direction === 'BUY' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
              {market.signal.direction} {market.signal.entry.toFixed(digits)}
            </span>{' '}
            · SL {market.signal.sl.toFixed(digits)} · TP {market.signal.tp.toFixed(digits)}
          </span>
        )}
      </div>

      {/* Interactive Active Trades Sync Strip */}
      {indicatorConfig.trades && activePositions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activePositions.map((pos) => {
            const isProfit = pos.profit >= 0;
            const isSelected = selectedTicket === pos.ticket;
            return (
              <button
                key={pos.ticket}
                type="button"
                onClick={() => tradingEngine.setSelectedTicket(pos.ticket)}
                className={`px-2 py-0.5 rounded-md border font-bold transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-sky-500/15 border-sky-500 text-sky-700 dark:text-sky-300'
                    : isProfit
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                }`}
                title={`Focus trade #${pos.ticket}`}
              >
                #{pos.ticket} {pos.type} {pos.volume.toFixed(2)}L ({isProfit ? '+' : ''}${pos.profit.toFixed(2)})
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});
