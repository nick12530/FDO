/**
 * HelpCenterModal.tsx - Comprehensive Multi-Pair & Technical Indicator Guide
 * Expanded and fully in sync with current system:
 * - Multi-Pair Playbook (XAUUSD, EURUSD, GBPUSD)
 * - Complete Indicator Suite (SMC Order Blocks, FVGs, ATR Volatility Bands, Candlesticks, MTF M1-H4, Sessions)
 * - Real-Time Financial News & Macro Catalyst Feed (RSS / API feed integration)
 * - Pending Limit Orders & Visual Holding Countdown Timer
 * - The 6 Institutional Execution Verification Gates
 * - Dealing Range & 50% Equilibrium (Discount vs Premium)
 * - MT5 Telemetry & Broker Synchronization
 */

import React, { useState, useMemo } from 'react';
import {
  X,
  BookOpen,
  Zap,
  Layers,
  Server,
  DollarSign,
  Compass,
  Search,
  BarChart3,
  Globe,
  Clock,
  Activity,
  Radio,
} from 'lucide-react';

interface HelpCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenBridge: () => void;
  initialTab?: TabType;
}

type TabType =
  | 'system_engines'
  | 'pairs_matrix'
  | 'indicators_suite'
  | 'real_time_news'
  | 'pending_orders'
  | 'valid_signals'
  | 'dealing_range'
  | 'balances'
  | 'abbreviations'
  | 'mt5';

interface TabItem {
  id: TabType;
  title: string;
  desc: string;
  searchText: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TABS: TabItem[] = [
  { id: 'system_engines', title: 'System Engines', desc: 'Signal analysis, readiness, risk checks', searchText: 'closed candles technical score 0-100 strategy readiness blocked spread risk expiry broker verification', icon: Activity },
  { id: 'real_time_news', title: 'Live News & Macro Feed', desc: 'Provider headlines, economic events, freshness', searchText: 'RSS headlines dictionary sentiment calendar Forex Factory Finnhub source actual actuals forecast previous unavailable stale refresh 15 minutes seven days', icon: Radio },
  { id: 'pairs_matrix', title: 'Instruments', desc: 'Supported symbols and broker specifications', searchText: 'XAUUSD gold EURUSD GBPUSD JPY broker contract size tick size digits symbol suffix', icon: Globe },
  { id: 'indicators_suite', title: 'Indicator Suite', desc: 'Structure, candles, volatility, timeframes', searchText: 'ATR candles MTF M1 M5 M15 H1 H4 order blocks fair value gaps BOS CHoCH liquidity sweep', icon: BarChart3 },
  { id: 'pending_orders', title: 'Pending Orders', desc: 'Broker order state and expiration', searchText: 'limit order pending order expiration MT5 status broker fill cancel', icon: Clock },
  { id: 'valid_signals', title: 'Execution Gates', desc: 'Readiness and rejection reasons', searchText: 'READY WAITING BLOCKED STALE DISCONNECTED score threshold spread risk news account position sizing execution rejection reason', icon: Zap },
  { id: 'dealing_range', title: 'Dealing Range & EQ', desc: 'Discount vs Premium zones', searchText: 'equilibrium EQ discount premium range high low 50 percent', icon: Compass },
  { id: 'balances', title: 'MT5 Balances & Margin', desc: 'Broker-reported account values', searchText: 'balance equity free margin used margin margin level currency stale unavailable', icon: DollarSign },
  { id: 'abbreviations', title: 'Glossary & Structure', desc: 'OB, BOS, CHoCH, FVG, ATR, SFP', searchText: 'order block break of structure change of character fair value gap average true range swing failure pattern', icon: Layers },
  { id: 'mt5', title: 'MT5 Live Bridge', desc: 'Connection, broker data, execution', searchText: 'MetaTrader 5 Windows bridge localhost 127.0.0.1 connect demo live broker account symbol', icon: Server },
];

export const HelpCenterModal: React.FC<HelpCenterModalProps> = ({
  isOpen,
  onClose,
  onOpenBridge,
  initialTab = 'pairs_matrix',
}) => {
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');

  React.useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  const filteredTabs = useMemo(() => {
    if (!searchQuery.trim()) return TABS;
    const q = searchQuery.toLowerCase();
    return TABS.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.desc.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q) ||
        t.searchText.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[170] flex justify-end bg-black/55 backdrop-blur-xs text-xs select-none">
      <div className="w-full max-w-3xl h-full ws-surface border-l shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 ws-subtle border-b flex items-center justify-between shrink-0 gap-3">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-slate-700 dark:text-slate-300" />
            <div>
              <h2 className="font-bold text-sm text-slate-900 dark:text-white uppercase tracking-wider">
                FDO User Manual
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                How to read live data, review setups, and use broker controls safely
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#1e2230] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Bar & Horizontal Tab Ribbon */}
        <div className="px-5 py-2.5 border-b border-slate-200 dark:border-[#1e2230] bg-slate-50/40 dark:bg-[#141722]/40 space-y-2 shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search topics (e.g. score, spread, calendar, ATR, MT5)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1 rounded-lg border border-slate-200 dark:border-[#1e2230] bg-white dark:bg-[#090a0f] text-slate-900 dark:text-white text-xs outline-none focus:border-slate-400"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            {filteredTabs.map((t) => {
              const Icon = t.icon;
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all cursor-pointer whitespace-nowrap text-xs ${
                    isActive
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-black border-transparent font-bold shadow-xs'
                      : 'bg-white dark:bg-[#141722] border-slate-200 dark:border-[#1e2230] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{t.title}</span>
                </button>
              );
            })}
          </div>
          {filteredTabs.length === 0 && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400" role="status">
              No guide topics match “{searchQuery}”.
            </p>
          )}
        </div>

        {/* Content Pane */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
          {activeTab === 'real_time_news' && (
            <div className="space-y-3">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Real-Time Financial News &amp; Macro Catalysts
              </h3>
              <p>
                Headlines and calendar events come from the configured live feeds relayed by the local bridge. Provider availability and coverage can vary; the calendar is an upcoming-events feed, not an archived actuals database.
              </p>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-[#1e2230] bg-slate-50/50 dark:bg-[#141722]/50 space-y-1.5">
                <span className="font-bold text-slate-900 dark:text-white block">Key Operational Highlights:</span>
                <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-400">
                  <li><strong>Headline sentiment:</strong> A local keyword-based heuristic labels headlines; it is not a forecast or a verified market-impact model.</li>
                  <li><strong>News refresh:</strong> The app checks live headlines periodically and exposes a manual refresh control. Empty or failed feeds are shown as unavailable.</li>
                  <li><strong>Source links:</strong> When a provider supplies a link, use it to inspect the original publication.</li>
                  <li><strong>Calendar:</strong> The bridge uses Forex Factory and an optional Finnhub fallback. The provider response covers upcoming events only; forecast, previous, or actual values may be missing.</li>
                </ul>
              </div>
            </div>
          )}

          {activeTab === 'system_engines' && (
            <div className="space-y-3">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Core Trading Engines &amp; Architecture
              </h3>
              <p>
                FDO is a desktop web interface connected to a local Python bridge and the selected MT5 terminal. Displayed market data and order state depend on broker connectivity and synchronization.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="p-3 rounded-xl border border-slate-200 dark:border-[#1e2230] bg-slate-50/50 dark:bg-[#141722]/50">
                  <strong className="text-slate-900 dark:text-white block">1. Signal Engine</strong>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Analyzes broker candle data, market structure, and technical confluence. A confluence score is not a win probability.
                  </span>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 dark:border-[#1e2230] bg-slate-50/50 dark:bg-[#141722]/50">
                  <strong className="text-slate-900 dark:text-white block">2. Risk Guardian</strong>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Checks broker specifications, configured risk limits, position exposure, and the kill switch before eligible orders.
                  </span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'pairs_matrix' && (
            <div className="space-y-3">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Supported Currency &amp; Commodity Instruments
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="p-3 rounded-xl border border-slate-200 dark:border-[#1e2230] bg-slate-50/50 dark:bg-[#141722]/50">
                  <strong className="text-slate-900 dark:text-white block">XAUUSD (Gold)</strong>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Symbol names, digits, contract terms, and volume limits depend on the connected broker. Confirm the selected Market Watch symbol and specifications.
                  </span>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 dark:border-[#1e2230] bg-slate-50/50 dark:bg-[#141722]/50">
                  <strong className="text-slate-900 dark:text-white block">EURUSD / GBPUSD</strong>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Broker specifications vary by account and symbol. Review the current quote, spread, session, and readiness reason before trading.
                  </span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'indicators_suite' && (
            <div className="space-y-3">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Indicator &amp; Structure Suite
              </h3>
              <p>
                Available analysis includes market structure (BOS/CHoCH), order blocks, fair value gaps, ATR, and timeframe alignment. Only closed candles are used for candle-based confirmation; unavailable or stale broker data should not be treated as a valid setup.
              </p>
            </div>
          )}

          {activeTab === 'valid_signals' && (
            <div className="space-y-3">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Read the current readiness state and exact blocking reason before acting.
              </h3>
              <ul className="list-decimal list-inside space-y-1 text-slate-600 dark:text-slate-400">
                <li>Fresh, broker-sourced quote and candle data</li>
                <li>Strategy and instrument-specific technical score threshold (score is shown on a 0–100 scale)</li>
                <li>Spread, setup expiry, and any strategy-specific conditions</li>
                <li>Position sizing from available broker symbol specifications and configured risk</li>
                <li>Portfolio and daily risk limits, including pending broker exposure</li>
                <li>News availability/restrictions, account state, kill switch, and broker order validation</li>
              </ul>
            </div>
          )}

          {activeTab === 'dealing_range' && (
            <div className="space-y-3">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Dealing Range &amp; 50% Equilibrium
              </h3>
              <p>
                Calculates the high and low boundaries of the active trading range. Prices below 50% are in Discount (favorable for BUY entries); prices above 50% are in Premium (favorable for SELL entries).
              </p>
            </div>
          )}

          {activeTab === 'mt5' && (
            <div className="space-y-3">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                MT5 Live Broker Bridge
              </h3>
              <p>
                The Python bridge communicates with the MetaTrader 5 terminal on the same Windows PC. Keep the bridge local and verify the selected account, broker server, symbol, and feed freshness before authorizing an order.
              </p>
            </div>
          )}

          {activeTab === 'balances' && (
            <div className="space-y-3">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                MT5 Balances, Margin &amp; Drawdown
              </h3>
              <p>
                Displays live Account Balance, Floating Equity, Margin Used, Free Margin, and Margin Level % reported directly by the MT5 broker server.
              </p>
            </div>
          )}

          {activeTab === 'abbreviations' && (
            <div className="space-y-3">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Glossary of Institutional Abbreviations
              </h3>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div><strong>OB:</strong> Order Block</div>
                <div><strong>BOS:</strong> Break of Structure</div>
                <div><strong>CHoCH:</strong> Change of Character</div>
                <div><strong>FVG:</strong> Fair Value Gap</div>
                <div><strong>OTE:</strong> Optimal Trade Entry</div>
                <div><strong>SFP:</strong> Swing Failure Pattern</div>
              </div>
            </div>
          )}

          {activeTab === 'pending_orders' && (
            <div className="space-y-3">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Pending Limit Orders &amp; Validity Timer
              </h3>
              <p>
                A pending order is a broker-side order only after MT5 confirms it. Check its current broker status, price, volume, and expiration in the terminal; do not assume an order is filled or cancelled until reconciled.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-[#1e2230] bg-slate-50/60 dark:bg-[#141722]/80 flex justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenBridge();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-300 dark:border-[#2b3b59] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1e2230] cursor-pointer"
          >
            <Server className="w-3.5 h-3.5" />
            Open MT5 Connection
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white dark:bg-white dark:text-slate-950 transition-colors cursor-pointer"
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};
