import React, { memo, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  ExternalLink,
  HelpCircle,
  Maximize2,
  RefreshCw,
  Eye,
  EyeOff,
  ChevronDown,
} from 'lucide-react';
import type { ChartTimeframe, SMCIndicatorConfig } from '../types/smc';
import { OfficialTradingViewEmbed } from './OfficialTradingViewEmbed';
import { SMCOverlayHUD } from './SMCOverlayHUD';
import { useTicker, useMarket } from '../hooks/useTradingStore';
import {
  useIndicatorSync,
  toggleShowIndicators,
  toggleIndicatorKey,
} from '../hooks/useIndicatorSync';
import { tradingEngine } from '../engine/tradingEngine';
import { getInstrumentConfig } from '../engine/instrumentConfig';

interface TradingViewWidgetProps {
  isDark?: boolean;
  symbol?: string;
  interval?: '1' | '5' | '15' | '60' | '240';
  height?: number | string;
  onExpand?: () => void;
  onOpenHelp?: () => void;
}

const timeframes: { value: ChartTimeframe; interval: NonNullable<TradingViewWidgetProps['interval']>; label: string }[] = [
  { value: 'M1', interval: '1', label: '1m' },
  { value: 'M5', interval: '5', label: '5m' },
  { value: 'M15', interval: '15', label: '15m' },
  { value: 'H1', interval: '60', label: '1h' },
  { value: 'H4', interval: '240', label: '4h' },
];

export const TradingViewWidget: React.FC<TradingViewWidgetProps> = memo(({
  isDark = true,
  symbol = 'OANDA:XAUUSD',
  interval: initialInterval = '1',
  height = 460,
  onExpand,
  onOpenHelp,
}) => {
  const ticker = useTicker();
  const market = useMarket();
  const { showIndicators, config: indicatorConfig } = useIndicatorSync();

  const initialTimeframe = timeframes.find((t) => t.interval === initialInterval)?.value ?? 'M1';
  const [selectedTf, setSelectedTf] = useState<ChartTimeframe>(() => market.currentTimeframe || initialTimeframe);
  const [showConfigMenu, setShowConfigMenu] = useState(false);
  const [chartKey, setChartKey] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  // Sync chart timeframe bidirectionally with tradingEngine
  useEffect(() => {
    if (market.currentTimeframe && market.currentTimeframe !== selectedTf) {
      setSelectedTf(market.currentTimeframe);
    }
  }, [market.currentTimeframe, selectedTf]);

  // Close indicator dropdown on outside click or Escape
  useEffect(() => {
    if (!showConfigMenu) return;
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowConfigMenu(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowConfigMenu(false);
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [showConfigMenu]);

  const handleSelectTimeframe = useCallback((tf: ChartTimeframe) => {
    setSelectedTf(tf);
    tradingEngine.setTimeframe(tf);
  }, []);

  const handleToggleLayer = useCallback((key: keyof SMCIndicatorConfig) => {
    toggleIndicatorKey(key);
  }, []);

  // Build native TradingView studies array directly synced to showIndicators + indicatorConfig
  const tvStudies = useMemo(() => {
    if (!showIndicators) return [];
    const list: string[] = [];
    if (indicatorConfig.tvEma) list.push('MAExp@tv-basicstudies');
    if (indicatorConfig.tvVwap) list.push('VWAP@tv-basicstudies');
    if (indicatorConfig.tvRsi) list.push('RSI@tv-basicstudies');
    return list;
  }, [showIndicators, indicatorConfig.tvEma, indicatorConfig.tvVwap, indicatorConfig.tvRsi]);

  const rawSymbol = symbol.includes(':') ? symbol.split(':').pop() || symbol : symbol;
  const instrumentCfg = getInstrumentConfig(ticker.symbol);
  const hasBrokerFeed = Boolean(market.brokerMarketData && ticker.bid > 0);
  const isFullHeight = typeof height === 'string';

  return (
    <div
      id="price-structure-chart"
      className={`ws-surface border rounded-xl overflow-hidden flex flex-col text-xs transition-colors ${
        isFullHeight ? 'h-full min-h-0' : ''
      }`}
    >
      {/* Single Uncrowded Chart Header Bar */}
      <div className="px-3.5 py-2 ws-subtle border-b flex items-center justify-between flex-wrap gap-2">
        {/* Left: Active Symbol + Synced Spot + Timeframes */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="font-mono font-extrabold text-slate-900 dark:text-white text-xs tracking-tight">
              {rawSymbol}
            </span>
            {hasBrokerFeed && (
              <span className="hidden sm:inline font-mono text-[11px] font-bold text-slate-600 dark:text-slate-300 tabular-nums">
                · {ticker.bid.toFixed(instrumentCfg.digits)} · {ticker.spread}pts
              </span>
            )}
          </div>

          {/* Segmented Timeframe Controls synced to tradingEngine */}
          <div className="flex items-center bg-white dark:bg-[#0b111d] p-0.5 rounded-lg border border-slate-300 dark:border-[#2b3b59] font-mono">
            {timeframes.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => handleSelectTimeframe(value)}
                aria-pressed={selectedTf === value}
                className={`px-2 py-0.5 rounded text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
                  selectedTf === value
                    ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
                title={`Switch chart & engine timeframe to ${label}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Synced Indicator Toggle & Chart Actions */}
        <div className="flex items-center gap-1.5">
          <div className="relative" ref={menuRef}>
            <div className="flex items-center rounded-lg border border-slate-300 dark:border-[#2b3b59] bg-white dark:bg-[#0b111d] p-0.5">
              <button
                type="button"
                onClick={toggleShowIndicators}
                aria-pressed={showIndicators}
                className={`px-2 py-1 rounded-md text-[11px] font-bold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  showIndicators
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
                title="Toggle TradingView studies & SMC level bar"
              >
                {showIndicators ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                <span>Indicators: {showIndicators ? 'ON' : 'OFF'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowConfigMenu((v) => !v)}
                aria-expanded={showConfigMenu}
                className="px-1.5 py-1 text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition-colors cursor-pointer"
                title="Configure chart studies & SMC levels"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>

            {showConfigMenu && (
              <div className="absolute right-0 top-full mt-1.5 z-50 w-60 rounded-xl ws-surface border p-3 shadow-2xl text-[11px] space-y-2.5">
                <div className="space-y-1">
                  <div className="font-extrabold text-slate-900 dark:text-white pb-1 border-b border-slate-200 dark:border-[#2b3b59] flex items-center justify-between">
                    <span>Chart Indicators (TV)</span>
                    <button
                      type="button"
                      onClick={() => setShowConfigMenu(false)}
                      className="text-[11px] font-semibold text-sky-600 dark:text-sky-400 cursor-pointer"
                    >
                      Done
                    </button>
                  </div>
                  {(
                    [
                      { key: 'tvEma', label: 'Exponential MA (EMA)' },
                      { key: 'tvVwap', label: 'Session VWAP' },
                      { key: 'tvRsi', label: 'Relative Strength (RSI)' },
                    ] as const
                  ).map(({ key, label }) => (
                    <label
                      key={key}
                      className="flex items-center justify-between gap-2 p-1 rounded hover:bg-slate-100 dark:hover:bg-[#1e2d48] cursor-pointer text-slate-700 dark:text-slate-200 font-semibold"
                    >
                      <span>{label}</span>
                      <input
                        type="checkbox"
                        checked={Boolean(indicatorConfig[key])}
                        onChange={() => handleToggleLayer(key)}
                        className="rounded border-slate-400 text-sky-500 focus:ring-sky-500"
                      />
                    </label>
                  ))}
                </div>

                <div className="space-y-1">
                  <div className="font-extrabold text-slate-900 dark:text-white pb-1 border-b border-slate-200 dark:border-[#2b3b59]">
                    System SMC Levels
                  </div>
                  {(
                    [
                      { key: 'orderBlocks', label: 'Order Blocks (OB)' },
                      { key: 'fairValueGaps', label: 'Fair Value Gaps (FVG)' },
                      { key: 'structure', label: 'Structure (BOS / CHoCH)' },
                      { key: 'signals', label: 'Signal POI Levels' },
                      { key: 'trades', label: 'Open Trade Markers' },
                    ] as const
                  ).map(({ key, label }) => (
                    <label
                      key={key}
                      className="flex items-center justify-between gap-2 p-1 rounded hover:bg-slate-100 dark:hover:bg-[#1e2d48] cursor-pointer text-slate-700 dark:text-slate-200 font-semibold"
                    >
                      <span>{label}</span>
                      <input
                        type="checkbox"
                        checked={Boolean(indicatorConfig[key])}
                        onChange={() => handleToggleLayer(key)}
                        className="rounded border-slate-400 text-sky-500 focus:ring-sky-500"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {onOpenHelp && (
            <button
              type="button"
              onClick={onOpenHelp}
              className="p-1.5 rounded text-slate-500 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white transition-colors cursor-pointer"
              title="View SMC abbreviations and strategy guide"
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setChartKey((key) => key + 1)}
            title="Reload chart"
            className="p-1.5 rounded text-slate-500 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              title="Fullscreen chart"
              className="p-1.5 rounded text-slate-500 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white transition-colors cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          )}

          <a
            href={`https://www.tradingview.com/symbols/${symbol.replace(':', '-')}/`}
            target="_blank"
            rel="noopener noreferrer"
            title="Open on TradingView"
            className="p-1.5 rounded text-slate-500 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Main Chart Canvas Area (100% Unobstructed TradingView Toolbar & Candles) */}
      <div
        className={`w-full relative ${isDark ? 'bg-[#0f172a]' : 'bg-white'} overflow-hidden ${
          isFullHeight ? 'flex-1 min-h-0' : 'shrink-0'
        }`}
        style={!isFullHeight && typeof height === 'number' ? { height: `${height}px` } : undefined}
      >
        <OfficialTradingViewEmbed
          key={`tv-${chartKey}`}
          symbol={symbol}
          isDark={isDark}
          interval={
            selectedTf === 'M1'
              ? '1'
              : selectedTf === 'M5'
              ? '5'
              : selectedTf === 'M15'
              ? '15'
              : selectedTf === 'H4'
              ? '240'
              : '60'
          }
          height={typeof height === 'number' ? height : '100%'}
          studies={tvStudies}
        />
      </div>

      {/* System-Synced SMC Levels Bar cleanly below the chart */}
      <SMCOverlayHUD
        showIndicators={showIndicators}
        indicatorConfig={indicatorConfig}
      />
    </div>
  );
});
