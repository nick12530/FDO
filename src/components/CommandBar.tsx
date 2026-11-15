import React, { useMemo, useState, useRef, useEffect } from 'react';
import {
  Bot,
  Server,
  AlertOctagon,
  ShieldAlert,
  SlidersHorizontal,
  Bell,
  History,
  BookOpen,
  Sun,
  Moon,
  Volume2,
  VolumeX,
  Play,
  CalendarDays,
  ChevronDown,
  Send,
} from 'lucide-react';
import { useTicker, useEngine, useWebhookState } from '../hooks/useTradingStore';
import { useAudioNotifications } from '../hooks/useAudioNotifications';
import { tradingEngine } from '../engine/tradingEngine';
import { SUPPORTED_SYMBOLS } from '../engine/instrumentConfig';

export type WorkspaceModal =
  | 'bridge'
  | 'settings'
  | 'closed_trades'
  | 'daily_report'
  | 'tradingview'
  | 'help'
  | 'webhook';

interface CommandBarProps {
  isDark: boolean;
  onToggleTheme: () => void;
  onOpenModal: (modal: WorkspaceModal) => void;
  onToggleKillSwitchPrompt: () => void;
}

type PreviewSound = 'signal' | 'trade' | 'precision' | 'profit' | 'loss';

const formatCurrency = (val: number | string) => {
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (Number.isNaN(num)) return '0.00';
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const CommandBar: React.FC<CommandBarProps> = React.memo(({
  isDark,
  onToggleTheme,
  onOpenModal,
  onToggleKillSwitchPrompt,
}) => {
  const ticker = useTicker();
  const engine = useEngine();
  const webhook = useWebhookState();
  const { isMuted, toggleMute, playTestSound } = useAudioNotifications();

  const [menuOpen, setMenuOpen] = useState(false);
  const [previewSound, setPreviewSound] = useState<PreviewSound>('precision');
  const menuRef = useRef<HTMLDivElement>(null);

  const mt5 = engine.mt5Account;
  const floatingPnl = Number((ticker.equity - ticker.balance).toFixed(2));
  const isProfit = floatingPnl >= 0;
  const isKill = engine.kill_switch;

  const cleanBrokerTime = useMemo(() => {
    if (!ticker.brokerTimeStr) return '00:00 UTC';
    return ticker.brokerTimeStr.replace(/^\d{4}[.-]\d{2}[.-]\d{2}\s*/, '');
  }, [ticker.brokerTimeStr]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-30 w-full neo-header border-b backdrop-blur-md">
      <div className="max-w-[1680px] mx-auto px-3 sm:px-5 py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {/* Zone 1: Brand Wordmark + Non-Overlapping Pair Tabs */}
        <div className="flex items-center gap-3 shrink-0 max-w-full">
          <span className="font-extrabold text-[15px] tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0">
            NIFTY
          </span>

          <div
            role="tablist"
            aria-label="Active trading instrument"
            className="flex items-center gap-0.5 p-0.5 rounded-lg ws-subtle border font-mono text-xs overflow-x-auto max-w-full"
          >
            {SUPPORTED_SYMBOLS.map((sym) => {
              const isActive = sym === ticker.symbol;
              return (
                <button
                  key={sym}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => tradingEngine.switchSymbol(sym)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-white dark:bg-[#090b10] text-slate-900 dark:text-white shadow-2xs border border-slate-200/80 dark:border-[#2a3347]'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 border border-transparent'
                  }`}
                >
                  {sym}
                </button>
              );
            })}
          </div>
        </div>

        {/* Zone 2: Wide-Desktop Account Telemetry (2xl+ only so it never crowds narrower screens) */}
        <div className="hidden 2xl:flex items-center gap-2.5 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
          <span>
            Bal <strong className="font-mono text-slate-900 dark:text-slate-100 tabular-nums">${formatCurrency(ticker.balance)}</strong>
          </span>
          <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
          <span>
            Eq{' '}
            <strong
              className={`font-mono tabular-nums ${
                isProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              ${formatCurrency(ticker.equity)}
            </strong>
          </span>
          <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
          <span className="font-mono text-[11px] tabular-nums">{cleanBrokerTime}</span>
        </div>

        {/* Zone 3: Streamlined Action Controls (shrink-0, wraps cleanly as a group on narrow screens) */}
        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          {/* MT5 Connection */}
          <button
            type="button"
            onClick={() => onOpenModal('bridge')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              mt5?.connected
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                : 'ws-subtle text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-[#1b2130]'
            }`}
            title="MT5 Bridge Status & Account Link"
          >
            <Server className={`w-3.5 h-3.5 shrink-0 ${mt5?.connected ? 'text-emerald-500' : 'text-slate-400'}`} />
            <span className="font-mono">
              {mt5?.connected ? `MT5 #${mt5.login}` : 'MT5'}
            </span>
          </button>

          {/* Auto-Trade Toggle */}
          <button
            type="button"
            onClick={() => tradingEngine.toggleAutoTrade()}
            aria-pressed={engine.auto_trade}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              engine.auto_trade
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                : 'ws-subtle text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-[#1b2130]'
            }`}
            title={engine.auto_trade ? 'Auto-Trader active' : 'Auto-Trader off'}
          >
            <Bot className="w-3.5 h-3.5 shrink-0" />
            <span className="font-mono">Auto {engine.auto_trade ? 'ON' : 'OFF'}</span>
          </button>

          {/* Telegram Status */}
          <button
            type="button"
            onClick={() => onOpenModal('webhook')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              webhook.status === 'ACTIVE'
                ? 'bg-sky-500/10 border-sky-500/30 text-sky-700 dark:text-sky-300'
                : webhook.status === 'ERROR'
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                  : webhook.status === 'PAUSED'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300'
                    : 'ws-subtle text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-[#1b2130]'
            }`}
            title={
              webhook.status === 'ACTIVE'
                ? `Telegram Sync Active (${webhook.sentCount} delivered)`
                : webhook.status === 'ERROR'
                  ? `Telegram Error: ${webhook.lastError || 'Check settings'}`
                  : webhook.status === 'PAUSED'
                    ? 'Telegram Alerts Paused — click to enable'
                    : 'Configure Telegram Signal Alerts'
            }
          >
            <Send className={`w-3.5 h-3.5 shrink-0 ${webhook.status === 'ACTIVE' ? 'text-sky-500' : ''}`} />
            <span className="hidden sm:inline font-mono">
              TG {webhook.status === 'UNCONFIGURED' ? 'Setup' : webhook.status === 'ACTIVE' ? 'Live' : webhook.status}
            </span>
          </button>

          {/* Kill Switch */}
          <button
            type="button"
            onClick={onToggleKillSwitchPrompt}
            aria-pressed={isKill}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              isKill
                ? 'bg-rose-600 text-white border-rose-600'
                : 'ws-subtle text-slate-700 dark:text-slate-300 hover:border-rose-400/50 hover:text-rose-600 dark:hover:text-rose-400'
            }`}
            title="Emergency Kill Switch"
          >
            <AlertOctagon className={`w-3.5 h-3.5 shrink-0 ${isKill ? 'text-white' : 'text-rose-500'}`} />
            <span className="hidden md:inline font-mono">
              {isKill ? 'HALTED' : 'Kill'}
            </span>
          </button>

          {/* Theme Switch */}
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label="Toggle color theme"
            className="p-1.5 rounded-lg ws-subtle border text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors cursor-pointer shrink-0"
            title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Workspace Menu Dropdown */}
          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-expanded={menuOpen}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg ws-subtle border text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-[#1b2130] transition-colors cursor-pointer whitespace-nowrap"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">Menu</span>
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-2 w-72 rounded-xl ws-surface border shadow-xl p-2 z-50 space-y-1 text-xs">
                <div className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center justify-between">
                  <span>Account &amp; Workspace</span>
                  <span className="font-mono text-slate-700 dark:text-slate-200 tabular-nums">
                    ${formatCurrency(ticker.equity)}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); onOpenModal('closed_trades'); }}
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-[#1b2130] text-slate-700 dark:text-slate-200 transition-colors cursor-pointer text-left"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <History className="w-3.5 h-3.5 text-sky-500" />
                    Trade History &amp; Calendar
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); onOpenModal('daily_report'); }}
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-[#1b2130] text-slate-700 dark:text-slate-200 transition-colors cursor-pointer text-left"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <CalendarDays className="w-3.5 h-3.5 text-emerald-500" />
                    Daily Performance Report
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); onOpenModal('settings'); }}
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-[#1b2130] text-slate-700 dark:text-slate-200 transition-colors cursor-pointer text-left"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
                    Risk &amp; Drawdown Rules
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); onOpenModal('webhook'); }}
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-[#1b2130] text-slate-700 dark:text-slate-200 transition-colors cursor-pointer text-left"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <Bell className="w-3.5 h-3.5 text-sky-500" />
                    Telegram &amp; Webhook Alerts
                  </span>
                  <span
                    className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      webhook.status === 'ACTIVE'
                        ? 'bg-emerald-500/15 text-emerald-500'
                        : webhook.status === 'ERROR'
                          ? 'bg-rose-500/15 text-rose-500'
                          : 'bg-slate-500/15 text-slate-400'
                    }`}
                  >
                    {webhook.status}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); onOpenModal('help'); }}
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-[#1b2130] text-slate-700 dark:text-slate-200 transition-colors cursor-pointer text-left"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <BookOpen className="w-3.5 h-3.5 text-slate-400" />
                    User Guide &amp; Shortcuts
                  </span>
                </button>

                <div className="border-t border-slate-200 dark:border-[#2b3b59] my-1 pt-1.5 px-2.5 space-y-2">
                  {/* Circuit Breaker Toggle */}
                  <div className="flex items-center justify-between py-1">
                    <span className="font-medium text-slate-600 dark:text-slate-300">
                      Daily-Loss Breaker
                    </span>
                    <button
                      type="button"
                      onClick={() => void tradingEngine.toggleCircuitBreaker()}
                      className={`px-2 py-0.5 rounded font-mono text-[11px] font-bold cursor-pointer border ${
                        engine.circuit_breaker_enabled
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                          : 'bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-300'
                      }`}
                    >
                      {engine.circuit_breaker_enabled ? 'ON' : 'BYPASSED'}
                    </button>
                  </div>

                  {/* Audio Controls */}
                  <div className="flex items-center justify-between py-1 gap-2">
                    <button
                      type="button"
                      onClick={toggleMute}
                      className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer font-medium"
                    >
                      {isMuted ? (
                        <VolumeX className="w-3.5 h-3.5 text-slate-400" />
                      ) : (
                        <Volume2 className="w-3.5 h-3.5 text-emerald-500" />
                      )}
                      <span>{isMuted ? 'Audio Muted' : 'Audio On'}</span>
                    </button>

                    <div className="flex items-center gap-1 ws-subtle border rounded-md px-1.5 py-0.5">
                      <select
                        value={previewSound}
                        onChange={(e) => setPreviewSound(e.target.value as PreviewSound)}
                        aria-label="Select chime sound preview"
                        className="bg-transparent text-[11px] font-mono text-slate-700 dark:text-slate-300 focus:outline-hidden cursor-pointer"
                      >
                        <option value="precision" className="bg-white dark:bg-[#0f1219]">Precision</option>
                        <option value="signal" className="bg-white dark:bg-[#0f1219]">Signal</option>
                        <option value="trade" className="bg-white dark:bg-[#0f1219]">Trade</option>
                        <option value="profit" className="bg-white dark:bg-[#0f1219]">Profit</option>
                        <option value="loss" className="bg-white dark:bg-[#0f1219]">Loss</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => playTestSound(previewSound)}
                        aria-label={`Test ${previewSound} sound`}
                        className="p-0.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white cursor-pointer"
                      >
                        <Play className="w-3 h-3 fill-current" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
});
