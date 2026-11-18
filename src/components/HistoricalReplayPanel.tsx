import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Play, RefreshCw } from 'lucide-react';
import type { InstrumentType } from '../types/smc';
import { getSupportedSymbol, type SupportedSymbol } from '../engine/instrumentConfig';
import {
  discoverTechnicalReplaySignals,
  replayHistoricalSignals,
  type HistoricalReplayResult,
  type ReplayMetrics,
} from '../engine/historicalReplay';
import { mt5Bridge, type HistoricalResearchResponse } from '../engine/mt5Bridge';

interface ReplayRun {
  result: HistoricalReplayResult;
  candleCount: number;
  tickCount: number;
  accountLogin: number;
  accountServer: string;
  start: number;
  end: number;
}

interface HistoricalReplayPanelProps {
  symbol: string;
  instrumentType: InstrumentType;
}

function isConsistentAccount(responses: HistoricalResearchResponse[]): boolean {
  return responses.every(
    (response) =>
      response.source === 'MetaTrader5' &&
      response.accountLogin === responses[0].accountLogin &&
      response.accountServer === responses[0].accountServer &&
      response.symbol === responses[0].symbol
  );
}

export const HistoricalReplayPanel: React.FC<HistoricalReplayPanelProps> = ({
  symbol: requestedSymbol,
  instrumentType,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<ReplayRun | null>(null);
  const requestGeneration = useRef(0);
  const supportedSymbol = getSupportedSymbol(requestedSymbol);

  useEffect(() => {
    requestGeneration.current += 1;
    setRun(null);
    setError(null);
    setIsLoading(false);
  }, [requestedSymbol]);

  const executeReplay = async () => {
    if (!supportedSymbol) {
      setError(`Historical replay is not configured for ${requestedSymbol}.`);
      return;
    }
    const generation = ++requestGeneration.current;
    setIsLoading(true);
    setError(null);
    setRun(null);
    const end = Math.floor(Date.now() / 1000);
    const start = end - 7 * 24 * 60 * 60;
    try {
      const responses = await Promise.all([
        mt5Bridge.getHistoricalCandles(supportedSymbol, 'M1', start, end),
        mt5Bridge.getHistoricalCandles(supportedSymbol, 'M5', start, end),
        mt5Bridge.getHistoricalCandles(supportedSymbol, 'M15', start, end),
        mt5Bridge.getHistoricalCandles(supportedSymbol, 'H1', start, end),
        mt5Bridge.getHistoricalTicks(supportedSymbol, start, end),
      ]);
      if (generation !== requestGeneration.current) return;
      if (!isConsistentAccount(responses)) {
        throw new Error('Historical responses do not share the same MT5 source, account, and broker symbol. Retry after reconnecting.');
      }
      const [m1, m5, m15, h1, tickResponse] = responses;
      const market = {
        M1: m1.candles ?? [],
        M5: m5.candles ?? [],
        M15: m15.candles ?? [],
        H1: h1.candles ?? [],
      };
      const ticks = tickResponse.ticks ?? [];
      const tickSize = m1.symbolSpec?.tickSize;
      const digits = m1.symbolSpec?.digits;
      const signals = discoverTechnicalReplaySignals(supportedSymbol, market, {
        instrumentType,
        tickSize: tickSize !== null && tickSize !== undefined && tickSize > 0 ? tickSize : undefined,
        digits: digits !== null && digits !== undefined ? digits : undefined,
      });
      const result = replayHistoricalSignals(signals, ticks, {
        ticksAvailable: tickResponse.count > 0,
      });
      const minimumBars = 52;
      const shortFrames = Object.entries(market)
        .filter(([, candles]) => candles.length < minimumBars)
        .map(([timeframe, candles]) => `${timeframe}: ${candles.length}/${minimumBars}`);
      if (shortFrames.length > 0) {
        result.unavailableReasons.unshift(
          `Insufficient broker candle history for ${shortFrames.join(', ')}; 52 closed bars are required per timeframe.`
        );
      }
      setRun({
        result,
        candleCount: Object.values(market).reduce((total, candles) => total + candles.length, 0),
        tickCount: tickResponse.count,
        accountLogin: m1.accountLogin,
        accountServer: m1.accountServer,
        start,
        end,
      });
    } catch (reason) {
      if (generation === requestGeneration.current) {
        setError(reason instanceof Error ? reason.message : 'Historical MT5 data could not be loaded.');
      }
    } finally {
      if (generation === requestGeneration.current) setIsLoading(false);
    }
  };

  const result = run?.result;
  const metrics = result?.metrics;
  const performanceSufficient = Boolean(
    metrics &&
    metrics.resolvedCount >= 20 &&
    result?.outOfSample.testing.resolvedCount !== undefined &&
    result.outOfSample.testing.resolvedCount >= 5
  );

  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100">Read-only MT5 replay</h3>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            {supportedSymbol ?? requestedSymbol} · last 7 days · chronological closed-candle signals and broker bid/ask ticks
          </p>
        </div>
        <button
          type="button"
          onClick={() => void executeReplay()}
          disabled={isLoading || !supportedSymbol}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 font-semibold text-sky-700 hover:bg-sky-500/15 dark:text-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {isLoading ? 'Loading broker history…' : 'Load broker history & replay'}
        </button>
      </div>

      <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-amber-800 dark:text-amber-200">
        <div className="flex gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold">Research only. No orders are sent or positions modified.</p>
            <p>
              Technical strategies only. Historical SMC news context and broker transaction-cost schedules are unavailable;
              net performance is withheld. Gross R excludes fees and is not a forecast.
            </p>
          </div>
        </div>
      </div>

      {error && <p role="alert" className="rounded-lg border border-rose-500/25 bg-rose-500/5 p-3 text-rose-700 dark:text-rose-300">{error}</p>}

      {run && metrics && (
        <div className="space-y-3">
          <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
            Source: MT5 · Replay policy v{result.replayPolicyVersion} · Account {run.accountLogin} / {run.accountServer} · {new Date(run.start * 1000).toISOString()} – {new Date(run.end * 1000).toISOString()} · {run.candleCount.toLocaleString()} candles · {run.tickCount.toLocaleString()} ticks
          </p>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Signals" value={String(metrics.signalCount)} />
            <Metric label="Filled / resolved" value={`${metrics.filledCount} / ${metrics.resolvedCount}`} />
            <Metric label="Gross expectancy (R)" value={!performanceSufficient || metrics.grossExpectancyR === null ? 'Insufficient samples' : metrics.grossExpectancyR.toFixed(2)} />
            <Metric label="Gross profit factor" value={!performanceSufficient || metrics.grossProfitFactor === null ? 'Insufficient samples' : Number.isFinite(metrics.grossProfitFactor) ? metrics.grossProfitFactor.toFixed(2) : 'Unbounded'} />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Gross W / L / BE" value={`${metrics.wins} / ${metrics.losses} / ${metrics.breakevens}`} />
            <Metric label="Unresolved" value={String(metrics.unresolvedCount)} />
            <Metric label="Average MFE / MAE (R)" value={`${metrics.averageMfeR?.toFixed(2) ?? '—'} / ${metrics.averageMaeR?.toFixed(2) ?? '—'}`} />
            <Metric label="Net / drawdown" value="Unavailable: costs" />
          </div>

          <div className="rounded-lg border border-slate-200 p-3 dark:border-[#2b3b59]">
            <p className="font-semibold text-slate-800 dark:text-slate-200">Chronological out-of-sample split</p>
            <p className="mt-1 text-slate-500 dark:text-slate-400">
              Training resolved: {result.outOfSample.training.resolvedCount} · Test resolved: {result.outOfSample.testing.resolvedCount}
              {result.outOfSample.testing.resolvedCount >= 5 && result.outOfSample.testing.grossExpectancyR !== null
                ? ` · Test gross expectancy: ${result.outOfSample.testing.grossExpectancyR.toFixed(2)}R`
                : ' · Test result insufficient'}
            </p>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-[#2b3b59]">
            <table className="w-full min-w-[560px] text-left">
              <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 dark:bg-[#101722] dark:text-slate-400">
                <tr>
                  <th className="p-2.5">Segment</th>
                  <th className="p-2 text-right">Resolved / signals</th>
                  <th className="p-2 text-right">Gross expectancy (R)</th>
                  <th className="p-2.5 text-right">Gross PF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#2b3b59]">
                {([
                  { label: 'Strategy', rows: result.groups.strategy },
                  { label: 'Session', rows: result.groups.session },
                  { label: 'Timeframe', rows: result.groups.timeframe },
                  { label: 'Score range', rows: result.groups.scoreRange },
                ] as Array<{ label: string; rows: Record<string, ReplayMetrics> }>).flatMap(({ label, rows }) =>
                  Object.entries(rows).map(([name, group]) => (
                    <tr key={`${label}:${name}`}>
                      <td className="p-2.5 font-semibold">{label}: {name}</td>
                      <td className="p-2 text-right font-mono">{group.resolvedCount} / {group.signalCount}</td>
                      <td className="p-2 text-right font-mono">
                        {group.resolvedCount >= 20 && group.grossExpectancyR !== null
                          ? group.grossExpectancyR.toFixed(2)
                          : 'Insufficient'}
                      </td>
                      <td className="p-2.5 text-right font-mono">
                        {group.resolvedCount >= 20 && group.grossProfitFactor !== null
                          ? Number.isFinite(group.grossProfitFactor)
                            ? group.grossProfitFactor.toFixed(2)
                            : 'Unbounded'
                          : 'Insufficient'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {result.unavailableReasons.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-amber-700 dark:text-amber-300">
              {result.unavailableReasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="min-w-0 rounded-lg border border-slate-200 p-3 dark:border-[#2b3b59]">
    <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
    <p className="mt-1 truncate font-mono font-semibold text-slate-900 dark:text-white" title={value}>{value}</p>
  </div>
);
