import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Copy,
  RefreshCw,
  Server,
  X,
} from 'lucide-react';
import { getDefaultServerUrl, mt5Bridge } from '../engine/mt5Bridge';
import { tradingEngine } from '../engine/tradingEngine';
import { readLinkedAccountProfiles } from '../engine/tradeJournal';
import { useClosedTrades, useMarket } from '../hooks/useTradingStore';
import type { InstrumentType } from '../types/smc';

interface Mt5BridgeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SETUP_COMMAND = 'powershell -ExecutionPolicy Bypass -File .\\mt5-bridge\\start_pc.ps1';

export const Mt5BridgeModal: React.FC<Mt5BridgeModalProps> = ({ isOpen, onClose }) => {
  const [symbol, setSymbol] = useState('XAUUSD');
  const [instrumentType, setInstrumentType] = useState<InstrumentType>('standard');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [pingState, setPingState] = useState<{ testing: boolean; ok?: boolean; latencyMs?: number; error?: string } | null>(null);
  const [token, setToken] = useState(() => mt5Bridge.getBridgeToken());
  const [showTokenField, setShowTokenField] = useState(() => Boolean(mt5Bridge.getBridgeToken()));
  const [syncingHistory, setSyncingHistory] = useState(false);

  const market = useMarket();
  const closedTrades = useClosedTrades();
  const [connectionRefresh, setConnectionRefresh] = useState(0);
  const bridgeStatus = mt5Bridge.getStatus();
  const isConnected = bridgeStatus.connected;
  const isReconnecting = bridgeStatus.isReconnecting;
  const accountMode = market.accountMode ?? bridgeStatus.mode;
  const savedProfiles = readLinkedAccountProfiles();

  useEffect(() => {
    const timer = window.setInterval(() => setConnectionRefresh((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handlePing = async () => {
    setPingState({ testing: true });
    if (token) mt5Bridge.setBridgeToken(token.trim());
    const res = await mt5Bridge.ping();
    setPingState({ testing: false, ...res });
  };

  const handleConnect = async () => {
    if (!symbol.trim()) {
      setStatus('error');
      setMessage('Enter the exact symbol shown in your MT5 Market Watch.');
      return;
    }

    setStatus('connecting');
    setMessage('');
    try {
      const targetUrl = getDefaultServerUrl();
      const snapshot = await mt5Bridge.connectAccount({
        baseUrl: targetUrl,
        symbol: symbol.trim(),
        instrumentType,
        token: token.trim(),
      });
      tradingEngine.linkMt5Account(
        String(snapshot.account.login),
        snapshot.account.server,
        snapshot.account.balance,
        snapshot.account.equity
      );
      setStatus('connected');
      setMessage(`Connected to ${snapshot.accountMode.toUpperCase()} #${snapshot.account.login} on ${snapshot.account.server}. Trade history synced.`);
    } catch (error) {
      setStatus('error');
      const errText = error instanceof Error ? error.message : 'Unable to connect to the MT5 bridge.';
      if (errText.includes('401') || errText.toLowerCase().includes('token')) {
        setShowTokenField(true);
      }
      setMessage(errText);
    }
  };

  const handleSyncHistoryNow = async () => {
    if (!isConnected || syncingHistory) return;
    setSyncingHistory(true);
    try {
      const trades = await mt5Bridge.refreshAccountHistory();
      setStatus('connected');
      setMessage(`Fetched ${trades.length} closed trades for MT5 #${tradingEngine.mt5Account.login}.`);
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'History refresh failed.');
    } finally {
      setSyncingHistory(false);
    }
  };

  const handleDisconnect = async () => {
    await mt5Bridge.disconnectAccount();
    tradingEngine.unlinkMt5Account();
    setStatus('idle');
    setMessage('Dashboard disconnected. Saved ledger preserved for this MT5 account.');
  };

  const handleCopySetup = async () => {
    try {
      await navigator.clipboard.writeText(SETUP_COMMAND);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Could not copy setup command.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mt5-bridge-title"
      className="fixed inset-0 z-[170] flex justify-end bg-black/60 backdrop-blur-xs text-xs"
    >
      <div className="w-full max-w-lg h-full overflow-hidden border-l ws-surface shadow-2xl flex flex-col">
        <header className="flex items-center justify-between ws-subtle border-b px-5 py-3.5 shrink-0">
          <div className="flex items-center gap-2.5">
            <Server className="h-4 w-4 text-sky-500" />
            <div>
              <h2 id="mt5-bridge-title" className="text-sm font-extrabold text-slate-950 dark:text-white tracking-tight">
                MetaTrader 5 Link
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Per-account bridge &amp; real broker trade sync
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close MT5 bridge"
            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-[#1e2d48] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Active Connection Status */}
          <div
            className={`rounded-xl border p-4 space-y-3 ${
              isConnected
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100'
                : 'border-slate-200 dark:border-[#2b3b59] bg-slate-50/70 dark:bg-[#141f35] text-slate-700 dark:text-slate-200'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2.5">
                {isConnected ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                ) : isReconnecting ? (
                  <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-amber-500" />
                ) : (
                  <Server className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                )}
                <div>
                  <strong className="font-extrabold text-xs block">
                    {isConnected
                      ? isReconnecting
                        ? 'Reconnecting to MT5…'
                        : `${String(accountMode).toUpperCase()} · MT5 #${tradingEngine.mt5Account.login}`
                      : 'MT5 Not Connected'}
                  </strong>
                  <span className="text-[11px] font-mono opacity-80 block mt-0.5">
                    {isConnected
                      ? tradingEngine.mt5Account.server
                      : bridgeStatus.lastError || 'Open MT5 Desktop and log into the account you want to link.'}
                  </span>
                </div>
              </div>

              {isConnected && bridgeStatus.latencyMs && (
                <span className="text-[10px] font-mono font-bold text-emerald-600 dark:text-emerald-400 shrink-0">
                  {bridgeStatus.latencyMs}ms
                </span>
              )}
            </div>

            {isConnected && (
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-emerald-500/20 font-mono">
                <div>
                  <span className="text-[10px] opacity-70 block">Balance</span>
                  <strong className="text-xs tabular-nums">${tradingEngine.mt5Account.balance.toFixed(2)}</strong>
                </div>
                <div>
                  <span className="text-[10px] opacity-70 block">Equity</span>
                  <strong className="text-xs tabular-nums">${tradingEngine.mt5Account.equity.toFixed(2)}</strong>
                </div>
                <div className="flex items-center justify-between gap-1">
                  <div>
                    <span className="text-[10px] opacity-70 block">History</span>
                    <strong className="text-xs tabular-nums">{closedTrades.length} trades</strong>
                  </div>
                  <button
                    type="button"
                    onClick={handleSyncHistoryNow}
                    disabled={syncingHistory}
                    className="p-1.5 rounded-lg border border-emerald-500/30 hover:bg-emerald-500/20 cursor-pointer"
                    title="Sync trades from MT5"
                  >
                    <RefreshCw className={`w-3 h-3 ${syncingHistory ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Connection Parameters */}
          <section className="rounded-xl border border-slate-200 dark:border-[#2b3b59] bg-white dark:bg-[#141f35] p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-200">
                Broker Symbol
                <input
                  value={symbol}
                  onChange={(event) => setSymbol(event.target.value)}
                  disabled={isConnected}
                  placeholder="XAUUSD"
                  autoComplete="off"
                  className="mt-1.5 min-h-9 w-full rounded-lg border border-slate-300 dark:border-[#2b3b59] bg-slate-50 dark:bg-[#0b111d] px-3 py-1.5 font-mono text-xs text-slate-950 dark:text-white outline-none focus:border-sky-500 disabled:opacity-60"
                />
              </label>

              <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-200">
                Instrument Type
                <select
                  value={instrumentType}
                  onChange={(event) => setInstrumentType(event.target.value as InstrumentType)}
                  disabled={isConnected}
                  className="mt-1.5 min-h-9 w-full rounded-lg border border-slate-300 dark:border-[#2b3b59] bg-slate-50 dark:bg-[#0b111d] px-3 py-1.5 text-xs text-slate-950 dark:text-white outline-none focus:border-sky-500 disabled:opacity-60"
                >
                  <option value="standard">Standard FX / Metals / Indices</option>
                  <option value="synthetic">Synthetic Index</option>
                </select>
              </label>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-2 min-w-0">
                <code className="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {getDefaultServerUrl()}
                </code>
              </div>
              <button
                type="button"
                onClick={handlePing}
                disabled={pingState?.testing}
                className="shrink-0 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-[#2b3b59] bg-slate-50 dark:bg-[#0b111d] hover:bg-slate-100 dark:hover:bg-[#1e2d48] text-[11px] font-bold font-mono cursor-pointer flex items-center gap-1.5"
              >
                {pingState?.testing ? (
                  <RefreshCw className="h-3 w-3 animate-spin" />
                ) : (
                  <Activity className="h-3 w-3 text-sky-500" />
                )}
                <span>{pingState?.testing ? 'Pinging…' : 'Test Bridge'}</span>
              </button>
            </div>

            {pingState && !pingState.testing && (
              <div
                className={`p-2 rounded-lg text-[11px] font-mono border ${
                  pingState.ok
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                }`}
              >
                {pingState.ok
                  ? `Bridge reachable (${pingState.latencyMs}ms)`
                  : `Unreachable: ${pingState.error}`}
              </div>
            )}
          </section>

          {/* Linked Account Profiles History (Real previously connected MT5 accounts) */}
          {savedProfiles.length > 0 && (
            <section className="rounded-xl border border-slate-200 dark:border-[#2b3b59] bg-white dark:bg-[#141f35] p-4 space-y-2">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                Saved Account Ledgers ({savedProfiles.length})
              </span>
              <div className="divide-y divide-slate-100 dark:divide-[#23314c]">
                {savedProfiles.map((acct) => {
                  const isActive =
                    isConnected &&
                    String(tradingEngine.mt5Account.login) === acct.login &&
                    tradingEngine.mt5Account.server === acct.server;
                  return (
                    <div key={acct.accountKey} className="py-2 flex items-center justify-between gap-2 font-mono text-[11px]">
                      <div className="min-w-0">
                        <span className="font-bold text-slate-900 dark:text-white">
                          #{acct.login} · {acct.server}
                        </span>
                        <span className="block text-[10px] text-slate-400">
                          {acct.accountMode ? acct.accountMode.toUpperCase() : 'MT5'} · Last sync {new Date(acct.lastSyncedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <strong className="text-slate-900 dark:text-white block tabular-nums">
                          ${acct.lastBalance.toFixed(2)}
                        </strong>
                        {isActive && (
                          <span className="text-[10px] font-bold text-emerald-500">ACTIVE</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Daily Loss Circuit Breaker */}
          <section className="rounded-xl border border-slate-200 dark:border-[#2b3b59] bg-white dark:bg-[#141f35] p-4 flex items-center justify-between gap-3">
            <div>
              <span className="text-xs font-bold text-slate-900 dark:text-white block">
                Daily-Loss Circuit Breaker
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {mt5Bridge.getCircuitBreakerEnabled()
                  ? 'Locks new orders at 3% max daily drawdown'
                  : 'Bypassed (daily loss guard disabled)'}
              </span>
            </div>
            <button
              type="button"
              onClick={async () => {
                const curr = mt5Bridge.getCircuitBreakerEnabled();
                await tradingEngine.toggleCircuitBreaker(!curr);
                setConnectionRefresh((v) => v + 1);
              }}
              className={`px-3 py-1.5 rounded-lg font-mono text-[11px] font-bold cursor-pointer border shrink-0 ${
                mt5Bridge.getCircuitBreakerEnabled()
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                  : 'bg-amber-500 text-slate-950 border-amber-500'
              }`}
            >
              {mt5Bridge.getCircuitBreakerEnabled() ? 'ON' : 'OFF'}
            </button>
          </section>

          {/* Optional Security Token */}
          <section className="rounded-xl border border-slate-200 dark:border-[#2b3b59] bg-white dark:bg-[#141f35] p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Bridge Security Token
              </span>
              <button
                type="button"
                onClick={() => setShowTokenField((prev) => !prev)}
                className="text-[11px] font-mono text-sky-500 hover:underline cursor-pointer"
              >
                {showTokenField ? 'Hide' : 'Configure'}
              </button>
            </div>
            {showTokenField && (
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste token from bridge_token.txt (optional on localhost)"
                autoComplete="off"
                disabled={isConnected}
                className="min-h-9 w-full rounded-lg border border-slate-300 dark:border-[#2b3b59] bg-slate-50 dark:bg-[#0b111d] px-3 py-1.5 font-mono text-xs text-slate-950 dark:text-white outline-none focus:border-sky-500"
              />
            )}
          </section>

          {/* Collapsible First-Time Launcher Setup */}
          <details className="rounded-xl border border-slate-200 dark:border-[#2b3b59] bg-white dark:bg-[#141f35] p-3.5 group">
            <summary className="flex items-center justify-between cursor-pointer text-[11px] font-bold text-slate-700 dark:text-slate-200 list-none">
              <span>Local PC Bridge Launcher Command</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-2.5 space-y-2 text-[11px] text-slate-500 dark:text-slate-400">
              <p>Run in PowerShell on the same Windows PC running MT5 Desktop:</p>
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-[#2b3b59] bg-slate-50 dark:bg-[#0b111d] p-2">
                <code className="min-w-0 flex-1 break-all text-[10px] text-slate-700 dark:text-slate-300">
                  {SETUP_COMMAND}
                </code>
                <button
                  type="button"
                  onClick={() => void handleCopySetup()}
                  aria-label="Copy MT5 setup command"
                  className="shrink-0 rounded-md border border-slate-300 dark:border-[#2b3b59] p-1.5 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-[#1e2d48] cursor-pointer"
                >
                  {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </details>

          {message && (
            <div
              className={`rounded-xl border p-3 text-xs flex items-start gap-2 ${
                status === 'error'
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
              }`}
            >
              {status === 'error' ? (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              )}
              <span className="flex-1 break-words">{message}</span>
            </div>
          )}
          <span className="sr-only" aria-live="polite">{connectionRefresh}</span>
        </div>

        {/* Footer Actions */}
        <footer className="px-5 py-3.5 ws-subtle border-t flex items-center justify-end gap-2 shrink-0">
          {isConnected && (
            <button
              type="button"
              onClick={() => void handleDisconnect()}
              className="min-h-9 rounded-lg border border-slate-300 dark:border-[#2b3b59] px-4 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1e2d48] cursor-pointer"
            >
              Disconnect
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleConnect()}
            disabled={status === 'connecting' || isConnected}
            className="min-h-9 rounded-lg bg-slate-900 px-5 py-1.5 text-xs font-extrabold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 cursor-pointer"
          >
            {status === 'connecting' ? 'Connecting…' : isConnected ? 'MT5 Connected' : 'Connect Account'}
          </button>
        </footer>
      </div>
    </div>
  );
};
