/**
 * newsFeed.ts - Live world news feed (economic / political / financial)
 * Polls the authenticated local bridge once a minute and feeds
 * headline analysis into the trading decision engine.
 */

import { mt5Bridge } from './mt5Bridge';
import {
  analyzeWorldNews,
  enrichNewsItem,
  type NewsCategory,
  type NewsMarketAnalysis,
  type WorldNewsItem,
} from './newsAnalysis';

export interface NewsFeedState {
  connected: boolean;
  lastSyncTime: number | null;
  activeSource: string;
  items: WorldNewsItem[];
  analysis: NewsMarketAnalysis | null;
  syncCount: number;
  error: string | null;
  refreshing: boolean;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function hashId(parts: string[]): string {
  let hash = 0;
  const raw = parts.join('|');
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash << 5) - hash + raw.charCodeAt(i);
    hash |= 0;
  }
  return `web:${Math.abs(hash)}`;
}

function isNewsCategory(value: unknown): value is NewsCategory {
  return value === 'economic' || value === 'political' || value === 'financial' || value === 'general';
}

function safeArticleUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function normalizeItems(raw: unknown[]): WorldNewsItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const title = typeof record.title === 'string' ? record.title.trim() : '';
      if (!title) return null;
      const summaryValue = record.summary || record.description || record.content;
      const summary = stripHtml(typeof summaryValue === 'string' ? summaryValue : '');
      const url = safeArticleUrl(record.url || record.link);
      const source = typeof record.source === 'string' ? record.source.trim() : 'World Wire';
      const publishedAt = typeof record.publishedAt === 'string' ? record.publishedAt : '';
      if (!Number.isFinite(Date.parse(publishedAt))) return null;
      const category = isNewsCategory(record.category) ? record.category : 'general';
      const id = typeof record.id === 'string' ? record.id : hashId([title, url, publishedAt]);
      return enrichNewsItem({
        id,
        title: title.slice(0, 240),
        summary: summary.slice(0, 420),
        url,
        source,
        category,
        publishedAt,
      });
    })
    .filter((item): item is WorldNewsItem => Boolean(item));
}

async function fetchViaBridge(): Promise<{ items: WorldNewsItem[]; source: string }> {
  const payload = await mt5Bridge.fetchWorldNews();
  if (!payload.available || !Array.isArray(payload.items)) {
    throw new Error('The local bridge returned an invalid world-news response.');
  }
  const items = normalizeItems(payload.items);
  if (items.length === 0) {
    throw new Error('The news providers returned no valid, timestamped headlines.');
  }
  return { items, source: payload.source || 'Local bridge RSS feeds' };
}

class WorldNewsFeedService {
  private state: NewsFeedState = {
    connected: false,
    lastSyncTime: null,
    activeSource: 'World News Wire',
    items: [],
    analysis: null,
    syncCount: 0,
    error: null,
    refreshing: false,
  };

  private listeners = new Set<(state: NewsFeedState) => void>();
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private isFetching = false;
  private engineSync: ((items: WorldNewsItem[], analysis: NewsMarketAnalysis | null) => void) | null = null;

  constructor() {
    this.startFeed();
  }

  public setEngineSync(callback: ((items: WorldNewsItem[], analysis: NewsMarketAnalysis | null) => void) | null) {
    this.engineSync = callback;
    if (callback) {
      callback(this.state.connected && this.state.analysis ? this.state.items : [], this.state.connected ? this.state.analysis : null);
    }
  }

  public startFeed() {
    if (typeof window === 'undefined') return;
    void this.fetchNews();
    if (!this.pollInterval) {
      // News changes more slowly than quotes; avoid hammering public RSS providers.
      this.pollInterval = setInterval(() => {
        void this.fetchNews();
      }, 60_000);
    }
  }

  public stopFeed() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  public subscribe(listener: (state: NewsFeedState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getState(): NewsFeedState {
    return this.state;
  }

  public async fetchNews(): Promise<boolean> {
    if (this.isFetching) return false;
    this.isFetching = true;
    this.state = { ...this.state, refreshing: true };
    this.notify();

    try {
      const result = await fetchViaBridge();
      const analysis = analyzeWorldNews(result.items);
      this.state = {
        connected: true,
        lastSyncTime: Date.now(),
        activeSource: result.source,
        items: result.items,
        analysis,
        syncCount: this.state.syncCount + 1,
        error: null,
        refreshing: false,
      };
      this.notify();
      this.engineSync?.(result.items, analysis);
      return true;
    } catch (error) {
      this.state = {
        ...this.state,
        connected: false,
        refreshing: false,
        error: error instanceof Error ? error.message : 'News feed failed',
      };
      this.notify();
      this.engineSync?.([], null);
      return false;
    } finally {
      this.isFetching = false;
    }
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (err) {
        console.error('NewsFeed listener error:', err);
      }
    }
  }
}

export const worldNewsFeed = new WorldNewsFeedService();
