import React, { useEffect, useMemo, useState } from 'react';
import {
  Newspaper,
  RefreshCw,
  Globe2,
  Landmark,
  TrendingUp,
  AlertTriangle,
  ExternalLink,
  Radio,
} from 'lucide-react';
import { worldNewsFeed, type NewsFeedState } from '../engine/newsFeed';
import { tradingEngine } from '../engine/tradingEngine';
import {
  MAX_WORLD_NEWS_AGE_MS,
  type NewsCategory,
  type WorldNewsItem,
} from '../engine/newsAnalysis';

const CATEGORY_META: Record<
  NewsCategory | 'all',
  { label: string; className: string; icon: React.ReactNode }
> = {
  all: {
    label: 'All',
    className: 'bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-200',
    icon: <Globe2 className="w-3 h-3" />,
  },
  economic: {
    label: 'Economic',
    className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
    icon: <Landmark className="w-3 h-3" />,
  },
  financial: {
    label: 'Financial',
    className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
    icon: <TrendingUp className="w-3 h-3" />,
  },
  political: {
    label: 'Political',
    className: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20',
    icon: <AlertTriangle className="w-3 h-3" />,
  },
  general: {
    label: 'General',
    className: 'bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-300',
    icon: <Newspaper className="w-3 h-3" />,
  },
};

function relativeTime(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return 'just now';
  const deltaSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
  return `${Math.floor(deltaSec / 86400)}d ago`;
}

function sentimentLabel(item: WorldNewsItem): { text: string; className: string } {
  const s = item.sentiment ?? 0;
  if (s >= 0.35) return { text: 'Bullish tone', className: 'text-emerald-600 dark:text-emerald-400' };
  if (s <= -0.35) return { text: 'Bearish tone', className: 'text-rose-600 dark:text-rose-400' };
  return { text: 'Neutral', className: 'text-slate-500 dark:text-zinc-400' };
}

export const LiveNewsFeedPanel: React.FC = () => {
  const [feed, setFeed] = useState<NewsFeedState>(() => worldNewsFeed.getState());
  const [category, setCategory] = useState<NewsCategory | 'all'>('all');
  const [newsImpactEnabled, setNewsImpactEnabled] = useState(
    () => tradingEngine.worldNewsImpactEnabled
  );

  useEffect(() => {
    const unsubscribe = worldNewsFeed.subscribe(setFeed);
    return () => {
      unsubscribe();
    };
  }, []);

  const filtered = useMemo(() => {
    if (category === 'all') return feed.items;
    return feed.items.filter((item) => item.category === category);
  }, [feed.items, category]);

  const analysis = feed.analysis;
  const isFeedFresh =
    feed.connected &&
    feed.lastSyncTime !== null &&
    Date.now() - feed.lastSyncTime <= MAX_WORLD_NEWS_AGE_MS;
  const autoTradeWarning = newsImpactEnabled
    ? !isFeedFresh
      ? 'Auto-trading is blocked because the live world-news feed is unavailable or stale.'
      : analysis?.blockingReason
        ? `Auto-trading is blocked: ${analysis.blockingReason}.`
        : null
    : null;
  const riskClass =
    analysis?.riskLevel === 'extreme'
      ? 'text-rose-600 dark:text-rose-400'
      : analysis?.riskLevel === 'high'
        ? 'text-amber-600 dark:text-amber-400'
        : analysis?.riskLevel === 'elevated'
          ? 'text-sky-600 dark:text-sky-400'
          : 'text-emerald-600 dark:text-emerald-400';

  return (
    <div className="neo-panel neo-card w-full border rounded-2xl p-4 sm:p-5 font-mono text-xs flex flex-col gap-3 min-w-0">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span
              className={`absolute inline-flex h-full w-full rounded-full opacity-60 ${
                feed.connected ? 'bg-emerald-400 animate-ping' : 'bg-slate-400'
              }`}
            />
            <span
              className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                feed.connected ? 'bg-emerald-500' : 'bg-slate-400'
              }`}
            />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Newspaper className="w-4 h-4 text-slate-700 dark:text-zinc-200" />
              <h3 className="font-bold text-slate-900 dark:text-white uppercase tracking-wider text-xs sm:text-sm">
                Live World News Feed
              </h3>
              <span className="text-[10px] text-slate-500 dark:text-zinc-400 bg-slate-100 dark:bg-zinc-800/80 px-2 py-0.5 rounded border border-slate-200 dark:border-zinc-700/60">
                60s refresh
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5 truncate">
              {feed.activeSource}
              {feed.lastSyncTime ? ` · synced ${relativeTime(new Date(feed.lastSyncTime).toISOString())}` : ''}
              {analysis ? ` · ${analysis.summary}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 px-2.5 py-1.5 text-[10px] font-bold text-slate-700 dark:text-zinc-200 cursor-pointer">
            <input
              type="checkbox"
              checked={newsImpactEnabled}
              onChange={(event) => {
                const enabled = event.currentTarget.checked;
                tradingEngine.setWorldNewsImpactEnabled(enabled);
                setNewsImpactEnabled(enabled);
              }}
              className="accent-sky-500"
            />
            Let headlines affect trading
          </label>
          {analysis && (
            <span className={`flex items-center gap-1 text-[11px] font-bold uppercase ${riskClass}`}>
              <Radio className="w-3.5 h-3.5" />
              Risk {analysis.riskLevel}
            </span>
          )}
          <button
            type="button"
            onClick={() => void worldNewsFeed.fetchNews()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-200 font-bold border border-slate-200 dark:border-zinc-700 transition-colors cursor-pointer"
            title="Force refresh world news"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${feed.refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {autoTradeWarning && (
        <div
          role="status"
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] font-bold text-amber-800 dark:text-amber-200"
        >
          <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" />
          {autoTradeWarning}
          {feed.error ? ` ${feed.error}` : ''}
        </div>
      )}
      {!newsImpactEnabled && (
        <p className="text-[11px] text-slate-600 dark:text-zinc-300">
          Headlines are informational only and do not change signal scores or block entries. Scheduled economic-calendar checks remain separate.
        </p>
      )}

      {analysis && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {(Object.keys(analysis.currencyBias) as Array<keyof typeof analysis.currencyBias>).map((currency) => {
            const bias = analysis.currencyBias[currency];
            const positive = bias.score >= 0;
            return (
              <div
                key={currency}
                className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white/70 dark:bg-[#0a0d13] px-2.5 py-2"
              >
                <div className="text-[10px] uppercase text-slate-400 tracking-wider">{currency}</div>
                <div
                  className={`text-sm font-black tabular-nums ${
                    positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {positive ? '+' : ''}
                  {bias.score.toFixed(0)}
                </div>
                <div className="text-[10px] text-slate-500">{bias.headlineCount} hits</div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        {(Object.keys(CATEGORY_META) as Array<NewsCategory | 'all'>).map((key) => {
          if (key === 'general') return null;
          const meta = CATEGORY_META[key];
          const active = category === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setCategory(key)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${
                active
                  ? 'bg-sky-500 text-slate-950 border-sky-400'
                  : `${meta.className} border border-transparent hover:opacity-90`
              }`}
            >
              {meta.icon}
              <span>{meta.label}</span>
            </button>
          );
        })}
      </div>

      <div className="max-h-[340px] overflow-y-auto space-y-2 pr-1">
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-slate-500 dark:text-zinc-500 border border-dashed border-slate-200 dark:border-zinc-800 rounded-xl">
            {feed.error || 'Waiting for live headlines from world news wires…'}
          </div>
        ) : (
          filtered.slice(0, 24).map((item) => {
            const tone = sentimentLabel(item);
            const cat = CATEGORY_META[item.category] || CATEGORY_META.general;
            return (
              <a
                key={item.id}
                href={item.url || undefined}
                target="_blank"
                rel="noreferrer"
                className="block rounded-xl border border-slate-200 dark:border-zinc-800 bg-white/80 dark:bg-[#0a0d13] p-3 hover:border-sky-400/50 dark:hover:border-sky-500/40 transition-colors"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border ${cat.className}`}
                    >
                      {cat.icon}
                      {cat.label}
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-zinc-500 truncate">
                      {item.source}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-[10px]">
                    <span className={tone.className}>{tone.text}</span>
                    <span className="text-slate-400">{relativeTime(item.publishedAt)}</span>
                    {item.url ? <ExternalLink className="w-3 h-3 text-slate-400" /> : null}
                  </div>
                </div>
                <div className="font-bold text-slate-900 dark:text-white text-[12px] leading-snug">
                  {item.title}
                </div>
                {item.summary ? (
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-zinc-400 line-clamp-2">
                    {item.summary}
                  </p>
                ) : null}
                {item.currencies && item.currencies.length > 0 ? (
                  <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                    {item.currencies.map((currency) => (
                      <span
                        key={currency}
                        className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 text-[10px] font-bold text-slate-600 dark:text-zinc-300"
                      >
                        {currency}
                      </span>
                    ))}
                  </div>
                ) : null}
              </a>
            );
          })
        )}
      </div>
      <p className="text-[10px] leading-relaxed text-slate-400 dark:text-zinc-500">
        Headlines are a curated sample, not every world story. Sentiment and impact labels are keyword heuristics, not verified market analysis; open the source and verify before acting. TradingView chart visuals are not read as signal input.
      </p>
    </div>
  );
};
