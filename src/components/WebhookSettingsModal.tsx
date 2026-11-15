/**
 * WebhookSettingsModal.tsx - Telegram & External Webhook Alert Configuration
 *
 * Provides real-time setup, testing, and live delivery visibility for:
 * - Telegram Instant Push Alerts (@BotFather bot token + chat ID via relay)
 * - Discord / Custom Webhook integration
 * - Confluence filters, cooldown controls & execution notifications
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Bell,
  Send,
  CheckCircle2,
  AlertTriangle,
  Zap,
  Sliders,
  RotateCcw,
} from 'lucide-react';
import {
  getWebhookConfig,
  saveWebhookConfig,
  dispatchTestNotification,
  dispatchLiveSignalAlert,
  clearSignalCooldowns,
  WebhookConfig,
} from '../utils/webhookNotifier';
import {
  useMarket,
  useTicker,
  useScannerAnalyses,
  useWebhookState,
} from '../hooks/useTradingStore';
import type { SupportedSymbol } from '../engine/instrumentConfig';

interface WebhookSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const WebhookSettingsModal: React.FC<WebhookSettingsModalProps> = ({ isOpen, onClose }) => {
  const [config, setConfig] = useState<WebhookConfig>(getWebhookConfig());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const market = useMarket();
  const ticker = useTicker();
  const scannerAnalyses = useScannerAnalyses();
  const webhookState = useWebhookState();

  useEffect(() => {
    if (isOpen) {
      setConfig(getWebhookConfig());
      setTestResult(null);
      setSavedSuccess(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  const liveCandidate = useMemo(() => {
    const readyMatch = scannerAnalyses.find((a) => a.status === 'READY' && a.signal);
    if (readyMatch?.signal) {
      return {
        symbol: readyMatch.symbol,
        direction: readyMatch.signal.direction,
        timeframe: readyMatch.signal.timeframe,
        strategy: readyMatch.signal.strategy || 'Institutional SMC POI',
        entry: readyMatch.signal.entry,
        sl: readyMatch.signal.sl,
        tp: readyMatch.signal.tp,
        tp2: readyMatch.suggestedTP2,
        tp3: readyMatch.suggestedTP3,
        confluenceScore: readyMatch.confluenceScore,
        lotSize: readyMatch.safeLotSize || undefined,
        riskReward: readyMatch.riskRewardRatio.toFixed(1),
      };
    }

    const anySignalMatch = scannerAnalyses.find((a) => Boolean(a.signal));
    if (anySignalMatch?.signal) {
      return {
        symbol: anySignalMatch.symbol,
        direction: anySignalMatch.signal.direction,
        timeframe: anySignalMatch.signal.timeframe,
        strategy: anySignalMatch.signal.strategy || 'Institutional SMC POI',
        entry: anySignalMatch.signal.entry,
        sl: anySignalMatch.signal.sl,
        tp: anySignalMatch.signal.tp,
        tp2: anySignalMatch.suggestedTP2,
        tp3: anySignalMatch.suggestedTP3,
        confluenceScore: anySignalMatch.confluenceScore,
        lotSize: anySignalMatch.safeLotSize || undefined,
        riskReward: anySignalMatch.riskRewardRatio.toFixed(1),
      };
    }

    if (market.signal && ticker.bid > 0) {
      return {
        symbol: (ticker.symbol || 'XAUUSD') as SupportedSymbol,
        direction: market.signal.direction,
        timeframe: market.signal.timeframe,
        strategy: market.signal.strategy || 'Institutional SMC POI',
        entry: market.signal.entry,
        sl: market.signal.sl,
        tp: market.signal.tp,
        confluenceScore: Math.round(market.signal.score * 10),
      };
    }

    return null;
  }, [scannerAnalyses, market.signal, ticker.symbol, ticker.bid]);

  if (!isOpen) return null;

  const hasValidDraftCreds =
    ((config.type === 'telegram' || config.type === 'both') &&
      Boolean(config.telegramBotToken?.trim() && config.telegramChatId?.trim())) ||
    ((config.type === 'webhook' || config.type === 'both') && Boolean(config.webhookUrl?.trim()));

  const handleSave = (forceEnable?: boolean) => {
    const nextConfig: WebhookConfig = forceEnable ? { ...config, enabled: true } : config;
    setConfig(nextConfig);
    saveWebhookConfig(nextConfig);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 900);
  };

  const handleTestNotification = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      if ((config.type === 'telegram' || config.type === 'both') && (!config.telegramBotToken?.trim() || !config.telegramChatId?.trim())) {
        throw new Error('Please enter both Telegram Bot Token and Chat ID before testing.');
      }
      if ((config.type === 'webhook' || config.type === 'both') && !config.webhookUrl?.trim()) {
        throw new Error('Please enter a Webhook URL before testing.');
      }

      // Persist draft config so runtime state reflects updated credentials immediately
      saveWebhookConfig(config);
      const res = await dispatchTestNotification(config);
      if (!res.ok) {
        throw new Error(res.error || 'Failed to dispatch test alert.');
      }

      setTestResult({
        ok: true,
        msg: 'Test alert delivered cleanly. Check your Telegram / Webhook channel.',
      });
    } catch (err: unknown) {
      setTestResult({
        ok: false,
        msg: err instanceof Error ? err.message : 'Failed to dispatch test alert.',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSendLiveSignal = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      if (!hasValidDraftCreds) {
        throw new Error('Enter valid Telegram or Webhook destination credentials first.');
      }
      if (!liveCandidate) {
        throw new Error('No verified live scanner setup is currently active. Run Test Connection to verify delivery.');
      }

      saveWebhookConfig(config);
      const res = await dispatchLiveSignalAlert({
        ...liveCandidate,
        force: true,
      });

      if (!res.ok) {
        throw new Error(res.error || 'Failed to dispatch live signal.');
      }

      setTestResult({
        ok: true,
        msg: `Live signal for ${liveCandidate.symbol} (${liveCandidate.direction}) delivered.`,
      });
    } catch (err: unknown) {
      setTestResult({
        ok: false,
        msg: err instanceof Error ? err.message : 'Failed to dispatch live signal.',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[170] flex justify-end bg-black/55 backdrop-blur-xs text-xs select-none"
    >
      <div className="w-full max-w-xl h-full ws-surface border-l shadow-2xl flex flex-col overflow-hidden text-slate-800 dark:text-slate-200">
        {/* Header */}
        <div className="px-5 py-4 ws-subtle border-b flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-500">
              <Bell className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-sm text-slate-900 dark:text-white tracking-tight">
                  Telegram &amp; Webhook Alerts
                </h2>
                <span
                  className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                    webhookState.status === 'ACTIVE'
                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                      : webhookState.status === 'ERROR'
                        ? 'bg-rose-500/15 border-rose-500/30 text-rose-600 dark:text-rose-400'
                        : webhookState.status === 'PAUSED'
                          ? 'bg-amber-500/15 border-amber-500/30 text-amber-600 dark:text-amber-400'
                          : 'ws-subtle text-slate-500'
                  }`}
                >
                  {webhookState.status}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Real-time scanner signals and execution fill notifications across all 4 pairs
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Telegram settings"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-[#1b2130] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Master Enable Toggle */}
          <div className="p-3.5 rounded-xl bg-slate-100 dark:bg-zinc-900/80 border border-slate-200 dark:border-zinc-800 flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="font-extrabold text-xs text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-500" />
                <span>Enable Live Signal Sync</span>
              </span>
              <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                Automatically pushes scanner setups &amp; live MT5 fills via server relay
              </p>
            </div>

            <button
              type="button"
              onClick={() => setConfig((prev) => ({ ...prev, enabled: !prev.enabled }))}
              aria-pressed={config.enabled}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                config.enabled ? 'bg-amber-500' : 'bg-slate-300 dark:bg-zinc-700'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                  config.enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Alert Type Selector */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-700 dark:text-zinc-300 uppercase tracking-wider">
              Alert Destination
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['telegram', 'webhook', 'both'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setConfig((prev) => ({ ...prev, type: t }))}
                  className={`p-2.5 rounded-xl border text-center font-bold capitalize transition-all cursor-pointer ${
                    config.type === t
                      ? 'bg-amber-500/15 border-amber-500 text-amber-600 dark:text-amber-400 shadow-xs'
                      : 'bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-400 hover:border-slate-300 dark:hover:border-zinc-700'
                  }`}
                >
                  {t === 'both' ? 'Telegram & Webhook' : t}
                </button>
              ))}
            </div>
          </div>

          {/* Telegram Settings Section */}
          {(config.type === 'telegram' || config.type === 'both') && (
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#12151c] border border-slate-200 dark:border-zinc-800 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 pb-2">
                <span className="font-extrabold text-xs text-sky-600 dark:text-sky-400 flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5" />
                  <span>Telegram Bot Credentials</span>
                </span>
                <span className="text-[10px] text-slate-500 dark:text-zinc-400">Relayed Server-Side</span>
              </div>

              {/* Bot Token */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-slate-700 dark:text-zinc-300">
                    Bot API Token:
                  </label>
                  <span className="text-[10px] text-slate-500 dark:text-zinc-400">From @BotFather</span>
                </div>
                <input
                  type="text"
                  placeholder="e.g. 7123456789:AAHk..."
                  value={config.telegramBotToken}
                  onChange={(e) => setConfig((prev) => ({ ...prev, telegramBotToken: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 font-mono text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-amber-500"
                />
              </div>

              {/* Chat ID */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-slate-700 dark:text-zinc-300">
                    Your Telegram Chat ID:
                  </label>
                  <span className="text-[10px] text-slate-500 dark:text-zinc-400">From @userinfobot</span>
                </div>
                <input
                  type="text"
                  placeholder="e.g. 123456789 or -100123456789"
                  value={config.telegramChatId}
                  onChange={(e) => setConfig((prev) => ({ ...prev, telegramChatId: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 font-mono text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-amber-500"
                />
              </div>

              {/* Quick Guide */}
              <div className="p-2.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-[10px] text-sky-800 dark:text-sky-300 space-y-1">
                <span className="font-bold block">Quick Setup:</span>
                <ol className="list-decimal list-inside space-y-0.5 text-slate-600 dark:text-zinc-300">
                  <li>Message <b>@BotFather</b> on Telegram with <code>/newbot</code> to get a token.</li>
                  <li>Open your bot chat and press <b>Start</b> so it can message you.</li>
                  <li>Message <b>@userinfobot</b> to copy your numeric <b>Chat ID</b> (or channel ID).</li>
                </ol>
              </div>
            </div>
          )}

          {/* Custom Webhook Settings Section */}
          {(config.type === 'webhook' || config.type === 'both') && (
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#12151c] border border-slate-200 dark:border-zinc-800 space-y-2">
              <label className="text-[11px] font-bold text-slate-700 dark:text-zinc-300 uppercase tracking-wider block">
                Generic Webhook / Discord Endpoint URL
              </label>
              <input
                type="url"
                placeholder="https://discord.com/api/webhooks/... or https://your-server.com/api/alert"
                value={config.webhookUrl}
                onChange={(e) => setConfig((prev) => ({ ...prev, webhookUrl: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 font-mono text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-amber-500"
              />
            </div>
          )}

          {/* Notification Criteria Filters */}
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-zinc-900/50 border border-slate-200 dark:border-zinc-800 space-y-3">
            <span className="font-bold text-xs uppercase tracking-wider text-slate-800 dark:text-zinc-300 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-amber-500" />
              <span>Filter Sensitivity &amp; Rules</span>
            </span>

            <div className="space-y-2 text-[11px]">
              <label className="flex items-center justify-between cursor-pointer">
                <span>Only Verified Sniper POI Setups:</span>
                <input
                  type="checkbox"
                  checked={config.onlySniperSignals}
                  onChange={(e) => setConfig((prev) => ({ ...prev, onlySniperSignals: e.target.checked }))}
                  className="rounded border-zinc-700 text-amber-500 focus:ring-amber-400"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer">
                <span>Alert when an A+ entry trigger is approaching (not an order):</span>
                <input
                  type="checkbox"
                  checked={config.alertOnApproachingEntry}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, alertOnApproachingEntry: e.target.checked }))
                  }
                  className="rounded border-zinc-700 text-blue-500 focus:ring-blue-400"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer">
                <span>Notify On Order Fill Executions:</span>
                <input
                  type="checkbox"
                  checked={config.alertOnExecutions}
                  onChange={(e) => setConfig((prev) => ({ ...prev, alertOnExecutions: e.target.checked }))}
                  className="rounded border-zinc-700 text-amber-500 focus:ring-amber-400"
                />
              </label>

              <div className="flex items-center justify-between pt-1">
                <span>Minimum Confluence Floor:</span>
                <span className="font-extrabold text-amber-500">{config.minConfluenceScore} / 100</span>
              </div>
              <input
                type="range"
                min="50"
                max="100"
                step="1"
                value={config.minConfluenceScore}
                onChange={(e) => setConfig((prev) => ({ ...prev, minConfluenceScore: Number(e.target.value) }))}
                className="w-full accent-amber-500 cursor-pointer"
              />
            </div>
          </div>

          {/* Delivery Diagnostics */}
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-zinc-900/50 border border-slate-200 dark:border-zinc-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[11px] uppercase tracking-wider text-slate-600 dark:text-zinc-300">
                Recent Deliveries ({webhookState.sentCount} sent / {webhookState.failedCount} failed)
              </span>
              <button
                type="button"
                onClick={clearSignalCooldowns}
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-600 dark:text-sky-400 hover:underline cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Cooldowns</span>
              </button>
            </div>

            {webhookState.deliveryLog.length === 0 ? (
              <p className="text-[11px] text-slate-400">No dispatches logged in this browser session yet.</p>
            ) : (
              <div className="divide-y divide-slate-200/70 dark:divide-zinc-800 max-h-32 overflow-y-auto">
                {webhookState.deliveryLog.slice(0, 6).map((item) => (
                  <div key={item.id} className="py-1.5 flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate text-slate-700 dark:text-zinc-300">
                      <strong className={item.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}>
                        {item.ok ? 'OK' : 'ERR'}
                      </strong>{' '}
                      · {item.detail}
                    </span>
                    <span className="font-mono text-[10px] text-slate-400 shrink-0 tabular-nums">
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Test Status Banner */}
          {testResult && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                testResult.ok
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500" />
              )}
              <span className="font-bold">{testResult.msg}</span>
            </div>
          )}

          {savedSuccess && (
            <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-bold text-center">
              Alert configuration saved.
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t border-slate-100 dark:border-zinc-800 bg-slate-50/80 dark:bg-[#12151c] flex items-center justify-between gap-2 sm:gap-3 shrink-0 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              disabled={testing}
              onClick={handleTestNotification}
              className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-800 dark:text-zinc-200 border border-slate-300 dark:border-zinc-700 font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 text-[11px]"
            >
              <Send className="w-3.5 h-3.5 text-sky-500" />
              <span>{testing ? 'Sending...' : 'Test Connection'}</span>
            </button>

            <button
              type="button"
              disabled={testing || !liveCandidate}
              onClick={handleSendLiveSignal}
              className="px-3 py-2 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 text-sky-700 dark:text-sky-300 border border-sky-500/30 font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed text-[11px]"
              title={
                liveCandidate
                  ? `Dispatch live ${liveCandidate.symbol} (${liveCandidate.direction}) setup now`
                  : 'Waiting for a verified scanner setup'
              }
            >
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              <span>
                {liveCandidate ? `Send ${liveCandidate.symbol} Setup` : 'No Live Setup'}
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-600 dark:text-zinc-400 font-bold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            {!config.enabled && hasValidDraftCreds ? (
              <button
                type="button"
                onClick={() => handleSave(true)}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-wider transition-all shadow-md cursor-pointer"
              >
                Save &amp; Activate
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSave(false)}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-black uppercase tracking-wider transition-all shadow-md cursor-pointer"
              >
                Save Settings
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
