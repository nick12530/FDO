/**
 * webhookNotifier.ts - External Telegram & Webhook Alert Service
 * Reactive, observable notification pipeline dispatching instant alerts via:
 * - Server-side relay (/api/telegram/send & /api/webhook/send) with direct fallback
 * - Real-time delivery log & cooldown tracking synchronized across the workstation UI
 */

import { SupportedSymbol, getInstrumentConfig } from '../engine/instrumentConfig';

export interface WebhookConfig {
  enabled: boolean;
  type: 'telegram' | 'webhook' | 'both';
  telegramBotToken: string;
  telegramChatId: string;
  webhookUrl: string;
  minConfluenceScore: number;
  onlySniperSignals: boolean;
  alertOnApproachingEntry: boolean;
  alertOnExecutions: boolean;
  soundAlerts: boolean;
}

export interface WebhookDeliveryEntry {
  id: string;
  timestamp: string;
  symbol: string;
  direction?: 'BUY' | 'SELL';
  timeframe?: string;
  eventType: 'SNIPER_SIGNAL' | 'LIVE_SIGNAL' | 'APPROACHING_ENTRY' | 'ORDER_EXECUTED' | 'TEST_ALERT';
  confluenceScore?: number;
  destination: 'telegram' | 'webhook' | 'both';
  ok: boolean;
  detail: string;
}

export type WebhookConnectionStatus = 'ACTIVE' | 'PAUSED' | 'UNCONFIGURED' | 'ERROR';

export interface WebhookRuntimeState {
  config: WebhookConfig;
  status: WebhookConnectionStatus;
  hasTelegramCreds: boolean;
  hasWebhookCreds: boolean;
  hasValidDestination: boolean;
  lastError: string | null;
  lastDispatchAt: string | null;
  sentCount: number;
  failedCount: number;
  deliveryLog: WebhookDeliveryEntry[];
}

const STORAGE_KEY = 'mt5_webhook_alert_config_v1';
const DELIVERY_LOG_STORAGE_KEY = 'mt5_webhook_delivery_log_v1';
const MAX_DELIVERY_LOG_ITEMS = 30;

export const DEFAULT_WEBHOOK_CONFIG: WebhookConfig = {
  enabled: false,
  type: 'telegram',
  telegramBotToken: '',
  telegramChatId: '',
  webhookUrl: '',
  minConfluenceScore: 65,
  onlySniperSignals: false,
  alertOnApproachingEntry: true,
  alertOnExecutions: true,
  soundAlerts: true,
};

function isTestRuntime(): boolean {
  return (
    typeof (globalThis as any).vi !== 'undefined' ||
    typeof (globalThis as any).__vitest_worker__ !== 'undefined' ||
    (typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || !!process.env?.VITEST))
  );
}

export function getWebhookConfig(): WebhookConfig {
  if (typeof localStorage === 'undefined') return DEFAULT_WEBHOOK_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WEBHOOK_CONFIG;
    const stored = JSON.parse(raw) as Partial<WebhookConfig>;
    const minConfluenceScore = Number(stored.minConfluenceScore);
    return {
      ...DEFAULT_WEBHOOK_CONFIG,
      ...stored,
      minConfluenceScore: Number.isFinite(minConfluenceScore)
        ? Math.min(100, Math.max(50, minConfluenceScore))
        : DEFAULT_WEBHOOK_CONFIG.minConfluenceScore,
    };
  } catch {
    return DEFAULT_WEBHOOK_CONFIG;
  }
}

function readDeliveryLog(): WebhookDeliveryEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(DELIVERY_LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_DELIVERY_LOG_ITEMS) : [];
  } catch {
    return [];
  }
}

function persistDeliveryLog(entries: WebhookDeliveryEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(DELIVERY_LOG_STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_DELIVERY_LOG_ITEMS)));
  } catch {
    // Ignore storage quota errors
  }
}

// Anti-spam cooldown cache for sent signal IDs (prevents duplicate alerts within 5 minutes)
const recentlySentSignals = new Map<string, number>();
const recentlySentApproachingEntries = new Map<string, number>();

const webhookListeners = new Set<() => void>();
let deliveryLog: WebhookDeliveryEntry[] = readDeliveryLog();
let lastDispatchError: string | null = null;
let lastDispatchAt: string | null = deliveryLog[0]?.timestamp ?? null;
let cachedRuntimeState: WebhookRuntimeState | null = null;

function computeStatus(config: WebhookConfig): {
  status: WebhookConnectionStatus;
  hasTelegramCreds: boolean;
  hasWebhookCreds: boolean;
  hasValidDestination: boolean;
} {
  const hasTelegramCreds = Boolean(config.telegramBotToken?.trim() && config.telegramChatId?.trim());
  const hasWebhookCreds = Boolean(config.webhookUrl?.trim());
  const needsTelegram = config.type === 'telegram' || config.type === 'both';
  const needsWebhook = config.type === 'webhook' || config.type === 'both';

  const hasValidDestination =
    (needsTelegram && hasTelegramCreds) ||
    (needsWebhook && hasWebhookCreds);

  let status: WebhookConnectionStatus = 'PAUSED';
  if (!hasValidDestination) {
    status = 'UNCONFIGURED';
  } else if (!config.enabled) {
    status = 'PAUSED';
  } else if (lastDispatchError) {
    status = 'ERROR';
  } else {
    status = 'ACTIVE';
  }

  return { status, hasTelegramCreds, hasWebhookCreds, hasValidDestination };
}

function invalidateRuntimeState() {
  cachedRuntimeState = null;
}

function notifyWebhookListeners() {
  invalidateRuntimeState();
  webhookListeners.forEach((cb) => {
    try {
      cb();
    } catch {
      // Ignore subscriber errors
    }
  });
}

export function getWebhookRuntimeState(): WebhookRuntimeState {
  if (!cachedRuntimeState) {
    const config = getWebhookConfig();
    const { status, hasTelegramCreds, hasWebhookCreds, hasValidDestination } = computeStatus(config);
    const sentCount = deliveryLog.filter((item) => item.ok).length;
    const failedCount = deliveryLog.filter((item) => !item.ok).length;
    cachedRuntimeState = {
      config,
      status,
      hasTelegramCreds,
      hasWebhookCreds,
      hasValidDestination,
      lastError: lastDispatchError,
      lastDispatchAt,
      sentCount,
      failedCount,
      deliveryLog,
    };
  }
  return cachedRuntimeState;
}

export function subscribeWebhookState(listener: () => void): () => void {
  webhookListeners.add(listener);
  return () => {
    webhookListeners.delete(listener);
  };
}

function appendDeliveryLog(entry: Omit<WebhookDeliveryEntry, 'id' | 'timestamp'>) {
  const record: WebhookDeliveryEntry = {
    ...entry,
    id: `wh-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
  };
  deliveryLog = [record, ...deliveryLog].slice(0, MAX_DELIVERY_LOG_ITEMS);
  lastDispatchAt = record.timestamp;
  lastDispatchError = entry.ok ? null : entry.detail;
  persistDeliveryLog(deliveryLog);
  notifyWebhookListeners();
}

export function clearWebhookLog(): void {
  deliveryLog = [];
  lastDispatchError = null;
  persistDeliveryLog([]);
  notifyWebhookListeners();
}

export function clearSignalCooldowns(): void {
  recentlySentSignals.clear();
  recentlySentApproachingEntries.clear();
  notifyWebhookListeners();
}

export function getSignalCooldownRemainingMs(
  symbol: string,
  direction: 'BUY' | 'SELL',
  timeframe: string
): number {
  const now = Date.now();
  const key = `${symbol}-${direction}-${timeframe}`;
  const liveKey = `live-${symbol}-${direction}-${timeframe}`;
  const last = Math.max(recentlySentSignals.get(key) ?? 0, recentlySentSignals.get(liveKey) ?? 0);
  if (!last) return 0;
  return Math.max(0, 300_000 - (now - last));
}

export function saveWebhookConfig(config: WebhookConfig): void {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      // Ignore storage errors
    }
  }
  if (config.enabled) {
    lastDispatchError = null;
  }
  notifyWebhookListeners();
}

export function setWebhookEnabled(enabled: boolean): WebhookConfig {
  const current = getWebhookConfig();
  const updated = { ...current, enabled };
  saveWebhookConfig(updated);
  return updated;
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  htmlText: string
): Promise<{ ok: boolean; error?: string }> {
  if (!botToken?.trim() || !chatId?.trim()) {
    return { ok: false, error: 'Telegram Bot Token and Chat ID are required.' };
  }

  const cleanToken = botToken.trim().replace(/^bot/i, '');
  const cleanChatId = chatId.trim();

  // Prefer same-origin server relay in live browser sessions to avoid CORS blocks
  if (typeof window !== 'undefined' && !isTestRuntime()) {
    try {
      const relayRes = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: cleanToken,
          chatId: cleanChatId,
          text: htmlText,
          parseMode: 'HTML',
        }),
      });
      if (relayRes.status !== 404) {
        const relayData = await relayRes.json().catch(() => ({}));
        if (relayRes.ok && relayData.ok) {
          return { ok: true };
        }
        return {
          ok: false,
          error: relayData?.error || `Telegram relay HTTP ${relayRes.status}`,
        };
      }
    } catch {
      // Fall through to direct Telegram Bot API if local relay is unavailable
    }
  }

  const url = `https://api.telegram.org/bot${cleanToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cleanChatId,
        text: htmlText,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.description || `HTTP ${res.status}: Failed to dispatch Telegram message` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Network error connecting to Telegram API' };
  }
}

export async function sendCustomWebhook(
  webhookUrl: string,
  payload: Record<string, any>
): Promise<{ ok: boolean; error?: string }> {
  if (!webhookUrl?.trim()) {
    return { ok: false, error: 'Webhook URL is required.' };
  }

  try {
    const cleanUrl = webhookUrl.trim();
    let finalBody: Record<string, any> = payload;

    // Discord Webhook auto-adapter
    if (cleanUrl.includes('discord.com/api/webhooks')) {
      const isBuy = payload.direction === 'BUY';
      const color = isBuy ? 0x00E676 : 0xFF5252;
      const eventName = payload.event || 'SMC Signal Alert';
      finalBody = {
        content: `⚡ **NIFTY Institutional Trading Alert**`,
        embeds: [
          {
            title: `${payload.symbol || 'MARKET'} ${payload.direction || ''} · ${payload.strategy || eventName}`,
            description: payload.message || `Confluence Score: **${payload.confluenceScore ?? '—'}**/100`,
            color,
            fields: [
              ...(payload.entry !== undefined ? [{ name: 'Entry', value: `\`${payload.entry}\``, inline: true }] : []),
              ...(payload.sl !== undefined ? [{ name: 'Stop Loss', value: `\`${payload.sl}\``, inline: true }] : []),
              ...(payload.tp1 !== undefined || payload.tp !== undefined ? [{ name: 'Target', value: `\`${payload.tp1 || payload.tp}\``, inline: true }] : []),
              ...(payload.volume !== undefined ? [{ name: 'Volume', value: `\`${payload.volume}L\``, inline: true }] : []),
            ],
            footer: { text: 'NIFTY Trading Engine · Risk Guardrails Active' },
            timestamp: new Date().toISOString(),
          },
        ],
      };
    }

    if (typeof window !== 'undefined' && !isTestRuntime()) {
      try {
        const relayRes = await fetch('/api/webhook/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: cleanUrl, payload: finalBody }),
        });
        if (relayRes.status !== 404) {
          const relayData = await relayRes.json().catch(() => ({}));
          if (relayRes.ok && relayData.ok) {
            return { ok: true };
          }
          return {
            ok: false,
            error: relayData?.error || `Webhook relay HTTP ${relayRes.status}`,
          };
        }
      } catch {
        // Fall through to direct fetch
      }
    }

    const res = await fetch(cleanUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(finalBody),
    });

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: Webhook returned error response` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Network error connecting to Webhook endpoint' };
  }
}

export async function dispatchTestNotification(config: WebhookConfig): Promise<{ ok: boolean; error?: string }> {
  const testTime = new Date().toLocaleTimeString('en-GB', { timeZone: 'UTC' });
  const testHtml = `
⚡ <b>NIFTY TERMINAL TEST ALERT</b> ⚡
━━━━━━━━━━━━━━━━━━
<b>Status:</b> Telegram signal sync connected!
<b>Channel:</b> Multi-Pair SMC Scanner (M15/M5)
<b>Time:</b> ${testTime} UTC
━━━━━━━━━━━━━━━━━━
<i>Ready to deliver live institutional setups &amp; trade fills.</i>
`.trim();

  const errors: string[] = [];
  let delivered = false;

  if (config.type === 'telegram' || config.type === 'both') {
    const res = await sendTelegramMessage(config.telegramBotToken, config.telegramChatId, testHtml);
    if (res.ok) delivered = true;
    else if (res.error) errors.push(res.error);
  }

  if (config.type === 'webhook' || config.type === 'both') {
    const res = await sendCustomWebhook(config.webhookUrl, {
      event: 'TEST_ALERT',
      message: 'NIFTY Institutional Terminal webhook verified successfully.',
      timestamp: new Date().toISOString(),
    });
    if (res.ok) delivered = true;
    else if (res.error) errors.push(res.error);
  }

  const ok = delivered && errors.length === 0;
  const detail = ok
    ? 'Test alert delivered cleanly.'
    : errors.join(' | ') || 'No alert destination configured.';

  appendDeliveryLog({
    symbol: 'SYSTEM',
    eventType: 'TEST_ALERT',
    destination: config.type,
    ok,
    detail,
  });

  return ok ? { ok: true } : { ok: false, error: detail };
}

/**
 * Dispatches an automated Sniper Signal alert to configured Telegram and Webhook destinations
 */
export async function dispatchSniperAlert(params: {
  symbol: SupportedSymbol;
  direction: 'BUY' | 'SELL';
  timeframe: string;
  strategy: string;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  slPips: number;
  tp1Pips: number;
  tp2Pips: number;
  tp3Pips: number;
  confluenceScore: number;
  recommendedLot?: number;
  isSniper?: boolean;
  sniperGrade?: 'A+' | 'A' | 'B';
  optimalTradeEntry?: number;
  triggerPattern?: string;
  validUntil: number;
  force?: boolean;
}): Promise<boolean> {
  const config = getWebhookConfig();
  if (!config.enabled && !params.force) return false;

  if (!params.force) {
    if (isFilteredByConfig(config, params.confluenceScore, params.isSniper)) {
      return false;
    }
    if (params.validUntil <= Date.now()) {
      return false;
    }
  }

  const wantsTelegram = (config.type === 'telegram' || config.type === 'both') && Boolean(config.telegramBotToken?.trim() && config.telegramChatId?.trim());
  const wantsWebhook = (config.type === 'webhook' || config.type === 'both') && Boolean(config.webhookUrl?.trim());
  if (!wantsTelegram && !wantsWebhook) {
    return false;
  }

  // Deduplication check (cooldown: 5 mins per symbol + direction + timeframe)
  const signalKey = `${params.symbol}-${params.direction}-${params.timeframe}`;
  const now = Date.now();
  const lastSent = recentlySentSignals.get(signalKey);
  if (!params.force && lastSent && now - lastSent < 300_000) {
    return false;
  }
  recentlySentSignals.set(signalKey, now);

  const cfg = getInstrumentConfig(params.symbol);
  const isBuy = params.direction === 'BUY';
  const dirBadge = isBuy ? '🟢 BUY SETUP' : '🔴 SELL SETUP';
  const gradeLabel = params.sniperGrade ? ` • <b>Grade ${params.sniperGrade}</b>` : '';
  const oteLine = params.optimalTradeEntry
    ? `  • <b>OTE Entry Trigger:</b> <code>${params.optimalTradeEntry.toFixed(cfg.digits)}</code>\n`
    : '';
  const triggerLine = params.triggerPattern
    ? `  • <b>Trigger Pattern:</b> ${params.triggerPattern}\n`
    : '';
  const validUntil = new Date(params.validUntil).toLocaleTimeString('en-GB', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const telegramHtml = `
⚡️ <b>INSTITUTIONAL SIGNAL ALERT</b> ⚡️
━━━━━━━━━━━━━━━━━━━━━━━━
💎 <b>PAIR:</b> #${params.symbol}
🎯 <b>SETUP:</b> <b>${dirBadge}</b>
📊 <b>TIMEFRAME:</b> ${params.timeframe}  |  <b>CONFLUENCE:</b> ${params.confluenceScore}/100${gradeLabel}

📍 <b>ENTRY:</b> <code>${params.entry.toFixed(cfg.digits)}</code>
${oteLine}🛑 <b>STOP LOSS:</b> <code>${params.sl.toFixed(cfg.digits)}</code> (-${params.slPips} pips)

🎯 <b>TARGET OBJECTIVES:</b>
  ├ <b>TP 1:</b> <code>${params.tp1.toFixed(cfg.digits)}</code> (+${params.tp1Pips} pips) • 1:1.8 RR
  ├ <b>TP 2:</b> <code>${params.tp2.toFixed(cfg.digits)}</code> (+${params.tp2Pips} pips) • 1:3.2 RR <i>[Recommended]</i>
  └ <b>TP 3:</b> <code>${params.tp3.toFixed(cfg.digits)}</code> (+${params.tp3Pips} pips) • 1:5.5 RR <i>[Runner]</i>

🛡 <b>RISK MANAGEMENT:</b>
  • <b>Setup:</b> ${params.strategy}
${triggerLine}  • <b>Suggested Sizing:</b> <code>${params.recommendedLot ? `${params.recommendedLot.toFixed(2)} Lots` : 'Verify Risk Budget'}</code>
  • <b>Trade Rule:</b> Move Stop Loss to Break-Even (BE) once TP1 is secured
━━━━━━━━━━━━━━━━━━━━━━━━
⏳ <b>Valid until:</b> ${validUntil} UTC
⚠️ <i>Live broker quotes verified. Verify risk before execution.</i>
🕒 <i>${new Date(now).toLocaleTimeString('en-GB', { timeZone: 'UTC' })} UTC • NIFTY Trading System</i>
`.trim();

  let sent = false;
  const errors: string[] = [];

  if (wantsTelegram) {
    const res = await sendTelegramMessage(config.telegramBotToken, config.telegramChatId, telegramHtml);
    if (res.ok) sent = true;
    else if (res.error) errors.push(res.error);
  }

  if (wantsWebhook) {
    const payload = {
      event: 'SNIPER_SIGNAL',
      symbol: params.symbol,
      direction: params.direction,
      strategy: params.strategy,
      timeframe: params.timeframe,
      entry: params.entry,
      sl: params.sl,
      tp1: params.tp1,
      tp2: params.tp2,
      tp3: params.tp3,
      confluenceScore: params.confluenceScore,
      setupType: 'PRECISION_ENTRY',
      optimalTradeEntry: params.optimalTradeEntry,
      validUntil: new Date(params.validUntil).toISOString(),
      timestamp: new Date().toISOString(),
    };
    const res = await sendCustomWebhook(config.webhookUrl, payload);
    if (res.ok) sent = true;
    else if (res.error) errors.push(res.error);
  }

  if (!sent) {
    recentlySentSignals.delete(signalKey);
  }

  appendDeliveryLog({
    symbol: params.symbol,
    direction: params.direction,
    timeframe: params.timeframe,
    eventType: 'SNIPER_SIGNAL',
    confluenceScore: params.confluenceScore,
    destination: config.type,
    ok: sent,
    detail: sent
      ? `${params.symbol} ${params.direction} (${params.confluenceScore}/100) delivered`
      : errors.join(' | ') || 'Signal delivery failed',
  });

  return sent;
}

// Local helper namespace to avoid parameter object clutter
const paramsHelpers = {
  onlySniperOrScoreBlocked(config: WebhookConfig, confluenceScore: number, isSniper?: boolean): boolean {
    if (confluenceScore < config.minConfluenceScore) return true;
    if (config.onlySniperSignals && isSniper === false) return true;
    return false;
  },
};

// Re-export internal helper on params prototype safely via function instead:
function isFilteredByConfig(config: WebhookConfig, confluenceScore: number, isSniper?: boolean): boolean {
  return paramsHelpers.onlySniperOrScoreBlocked(config, confluenceScore, isSniper);
}

/**
 * Dispatches an active live signal directly to Telegram / Webhook (manual trigger or scanner sync)
 */
export async function dispatchLiveSignalAlert(params: {
  symbol: SupportedSymbol;
  direction: 'BUY' | 'SELL';
  timeframe: string;
  strategy: string;
  entry: number;
  sl: number;
  tp: number;
  tp2?: number;
  tp3?: number;
  confluenceScore: number;
  lotSize?: number;
  riskReward?: string | number;
  force?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const config = getWebhookConfig();
  const wantsTelegram = (config.type === 'telegram' || config.type === 'both') && Boolean(config.telegramBotToken?.trim() && config.telegramChatId?.trim());
  const wantsWebhook = (config.type === 'webhook' || config.type === 'both') && Boolean(config.webhookUrl?.trim());

  if (!wantsTelegram && !wantsWebhook) {
    return {
      ok: false,
      error: 'Telegram Bot Token/Chat ID or Webhook URL is missing. Configure credentials in Alerts Settings.',
    };
  }

  const signalKey = `live-${params.symbol}-${params.direction}-${params.timeframe}`;
  const now = Date.now();
  const lastSent = recentlySentSignals.get(signalKey);
  if (!params.force && lastSent && now - lastSent < 180_000) {
    return { ok: false, error: 'Signal already sent within the last 3 minutes.' };
  }
  recentlySentSignals.set(signalKey, now);

  const cfg = getInstrumentConfig(params.symbol);
  const isBuy = params.direction === 'BUY';
  const dirBadge = isBuy ? '🟢 BUY SETUP' : '🔴 SELL SETUP';
  const rr =
    params.riskReward ??
    (params.sl && params.entry
      ? (Math.abs(params.tp - params.entry) / Math.max(0.0001, Math.abs(params.entry - params.sl))).toFixed(1)
      : '—');

  const text = `
⚡ <b>NIFTY LIVE TRADING SIGNAL</b> ⚡
━━━━━━━━━━━━━━━━━━━━━━━━
💎 <b>PAIR:</b> #${params.symbol}
🎯 <b>DIRECTION:</b> <b>${dirBadge}</b>
📊 <b>TIMEFRAME:</b> ${params.timeframe}  |  <b>CONFLUENCE:</b> ${params.confluenceScore}/100

📍 <b>ENTRY PRICE:</b> <code>${params.entry.toFixed(cfg.digits)}</code>
🛑 <b>STOP LOSS:</b> <code>${params.sl.toFixed(cfg.digits)}</code>
🎯 <b>PRIMARY TARGET:</b> <code>${params.tp.toFixed(cfg.digits)}</code>
${params.tp2 ? `🎯 <b>TARGET 2:</b> <code>${params.tp2.toFixed(cfg.digits)}</code>\n` : ''}${params.tp3 ? `🎯 <b>TARGET 3:</b> <code>${params.tp3.toFixed(cfg.digits)}</code>\n` : ''}⚖️ <b>RISK/REWARD:</b> 1:${rr}

🛡 <b>SETUP:</b> ${params.strategy}
📦 <b>SUGGESTED VOLUME:</b> <code>${params.lotSize ? `${params.lotSize.toFixed(2)} Lots` : 'Verify Risk Budget'}</code>
━━━━━━━━━━━━━━━━━━━━━━━━
🕒 <i>${new Date(now).toLocaleTimeString('en-GB', { timeZone: 'UTC' })} UTC • Live Trading Terminal</i>
`.trim();

  let sent = false;
  const errors: string[] = [];

  if (wantsTelegram) {
    const res = await sendTelegramMessage(config.telegramBotToken, config.telegramChatId, text);
    if (res.ok) sent = true;
    else if (res.error) errors.push(res.error);
  }

  if (wantsWebhook) {
    const res = await sendCustomWebhook(config.webhookUrl, {
      event: 'LIVE_SIGNAL',
      symbol: params.symbol,
      direction: params.direction,
      timeframe: params.timeframe,
      strategy: params.strategy,
      entry: params.entry,
      sl: params.sl,
      tp: params.tp,
      confluenceScore: params.confluenceScore,
      volume: params.lotSize,
      timestamp: new Date(now).toISOString(),
    });
    if (res.ok) sent = true;
    else if (res.error) errors.push(res.error);
  }

  if (!sent) recentlySentSignals.delete(signalKey);

  const ok = sent && errors.length === 0;
  const detail = ok
    ? `${params.symbol} ${params.direction} (${params.confluenceScore}/100) sent manually`
    : errors.join(' | ') || 'Dispatch failed';

  appendDeliveryLog({
    symbol: params.symbol,
    direction: params.direction,
    timeframe: params.timeframe,
    eventType: 'LIVE_SIGNAL',
    confluenceScore: params.confluenceScore,
    destination: config.type,
    ok,
    detail,
  });

  return ok ? { ok: true } : { ok: false, error: detail };
}

export async function dispatchApproachingEntryAlert(params: {
  symbol: SupportedSymbol;
  direction: 'BUY' | 'SELL';
  timeframe: string;
  entry: number;
  optimalTradeEntry: number;
  sl: number;
  tp: number;
  confluenceScore: number;
  validUntil: number;
}): Promise<boolean> {
  const config = getWebhookConfig();
  if (
    !config.enabled ||
    !config.alertOnApproachingEntry ||
    params.confluenceScore < Math.max(88, config.minConfluenceScore) ||
    params.validUntil <= Date.now()
  ) {
    return false;
  }

  const wantsTelegram = (config.type === 'telegram' || config.type === 'both') && Boolean(config.telegramBotToken?.trim() && config.telegramChatId?.trim());
  const wantsWebhook = (config.type === 'webhook' || config.type === 'both') && Boolean(config.webhookUrl?.trim());
  if (!wantsTelegram && !wantsWebhook) return false;

  const signalKey = `${params.symbol}-${params.direction}-${params.timeframe}`;
  const now = Date.now();
  const lastSent = recentlySentApproachingEntries.get(signalKey);
  if (lastSent && now - lastSent < 300_000) return false;
  recentlySentApproachingEntries.set(signalKey, now);
  if (recentlySentApproachingEntries.size > 128) {
    for (const [key, timestamp] of recentlySentApproachingEntries) {
      if (now - timestamp > 3_600_000) recentlySentApproachingEntries.delete(key);
    }
  }

  const cfg = getInstrumentConfig(params.symbol);
  const validUntil = new Date(params.validUntil).toLocaleTimeString('en-GB', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const message = `
<b>ENTRY TRIGGER APPROACHING — NOT EXECUTED</b>
<b>${params.symbol} ${params.direction}</b> · ${params.timeframe} · Confluence ${params.confluenceScore}/100
Current quote: <code>${params.entry.toFixed(cfg.digits)}</code>
Trigger zone: <code>${params.optimalTradeEntry.toFixed(cfg.digits)}</code>
Stop: <code>${params.sl.toFixed(cfg.digits)}</code> · Target: <code>${params.tp.toFixed(cfg.digits)}</code>
Entry window closes: ${validUntil} UTC
Wait for the stated trigger and re-check the live quote, spread, and risk. This is not an order or a profit guarantee.
`.trim();

  let sent = false;
  const errors: string[] = [];
  if (wantsTelegram) {
    const result = await sendTelegramMessage(config.telegramBotToken, config.telegramChatId, message);
    sent = sent || result.ok;
    if (!result.ok && result.error) errors.push(result.error);
  }
  if (wantsWebhook) {
    const result = await sendCustomWebhook(config.webhookUrl, {
      event: 'ENTRY_TRIGGER_APPROACHING',
      ...params,
      timestamp: new Date(now).toISOString(),
      message,
    });
    sent = sent || result.ok;
    if (!result.ok && result.error) errors.push(result.error);
  }
  if (!sent) recentlySentApproachingEntries.delete(signalKey);

  appendDeliveryLog({
    symbol: params.symbol,
    direction: params.direction,
    timeframe: params.timeframe,
    eventType: 'APPROACHING_ENTRY',
    confluenceScore: params.confluenceScore,
    destination: config.type,
    ok: sent,
    detail: sent ? `Approaching OTE zone ${params.optimalTradeEntry.toFixed(cfg.digits)}` : errors.join(' | ') || 'Failed',
  });

  return sent;
}

/**
 * Dispatches an automated execution fill alert
 */
export async function dispatchExecutionNotification(params: {
  symbol: string;
  direction: string;
  volume: number;
  openPrice: number;
  sl: number;
  tp: number;
  ticket?: number;
}): Promise<void> {
  const config = getWebhookConfig();
  if (!config.enabled || !config.alertOnExecutions) return;

  const wantsTelegram = (config.type === 'telegram' || config.type === 'both') && Boolean(config.telegramBotToken?.trim() && config.telegramChatId?.trim());
  const wantsWebhook = (config.type === 'webhook' || config.type === 'both') && Boolean(config.webhookUrl?.trim());
  if (!wantsTelegram && !wantsWebhook) return;

  const sym = params.symbol.toUpperCase() as SupportedSymbol;
  const cfg = getInstrumentConfig(sym);
  const digits = cfg?.digits ?? 2;
  const isBuy = params.direction.toUpperCase() === 'BUY';
  const dirBadge = isBuy ? '🟢 BUY' : '🔴 SELL';

  const telegramHtml = `
✅ <b>TRADE EXECUTION CONFIRMED</b>
━━━━━━━━━━━━━━━━━━━━
🎫 <b>TICKET:</b> <code>#${params.ticket || 'DESK'}</code>
💎 <b>PAIR:</b> #${params.symbol}
⚡️ <b>DIRECTION:</b> <b>${dirBadge}</b>
📦 <b>VOLUME:</b> <code>${params.volume.toFixed(2)} Lots</code>
💵 <b>FILL PRICE:</b> <code>${params.openPrice.toFixed(digits)}</code>

🛑 <b>SL:</b> <code>${params.sl.toFixed(digits)}</code>
🎯 <b>TP:</b> <code>${params.tp.toFixed(digits)}</code>
━━━━━━━━━━━━━━━━━━━━
🕒 <i>Filled at ${new Date().toLocaleTimeString('en-GB', { timeZone: 'UTC' })} UTC • MT5 Broker Connected</i>
`.trim();

  let sent = false;
  const errors: string[] = [];

  if (wantsTelegram) {
    const res = await sendTelegramMessage(config.telegramBotToken, config.telegramChatId, telegramHtml);
    if (res.ok) sent = true;
    else if (res.error) errors.push(res.error);
  }

  if (wantsWebhook) {
    const res = await sendCustomWebhook(config.webhookUrl, {
      event: 'ORDER_EXECUTED',
      ...params,
      timestamp: new Date().toISOString(),
    });
    if (res.ok) sent = true;
    else if (res.error) errors.push(res.error);
  }

  appendDeliveryLog({
    symbol: params.symbol,
    direction: isBuy ? 'BUY' : 'SELL',
    eventType: 'ORDER_EXECUTED',
    destination: config.type,
    ok: sent,
    detail: sent ? `Fill #${params.ticket || 'DESK'} ${params.volume.toFixed(2)}L @ ${params.openPrice.toFixed(digits)}` : errors.join(' | ') || 'Failed',
  });
}

// Keep internal filter helper cleanly checked by TypeScript while allowing direct usage inside dispatchSniperAlert
export function canDispatchSetup(config: WebhookConfig, confluenceScore: number, isSniper?: boolean): boolean {
  return !isFilteredByConfig(config, confluenceScore, isSniper);
}
