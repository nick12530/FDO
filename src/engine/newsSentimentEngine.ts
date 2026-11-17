/**
 * newsSentimentEngine.ts - Real-Time Financial News & Market Catalyst Engine
 *
 * Fetches real-time financial news exclusively from live RSS / backend endpoints
 * (Vite /api/live-news relay and MT5 bridge /api/live-news).
 * Starts empty with zero mock/hardcoded headlines.
 */

import { NewsSentimentItem } from '../types/smc';
import { SupportedSymbol } from './instrumentConfig';
import { mt5Bridge } from './mt5Bridge';

function isTestRuntime(): boolean {
  return (
    typeof (globalThis as any).vi !== 'undefined' ||
    typeof (globalThis as any).__vitest_worker__ !== 'undefined' ||
    (typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || !!process.env?.VITEST))
  );
}

class NewsSentimentEngine {
  private newsItems: NewsSentimentItem[] = [];
  private listeners: Set<() => void> = new Set();
  private isFetching = false;
  private lastFetchTime = 0;
  private lastError: string | null = null;

  constructor() {
    if (typeof window !== 'undefined' && !isTestRuntime()) {
      setTimeout(() => {
        void this.fetchLiveNews(true);
      }, 1000);

      window.setInterval(() => {
        void this.fetchLiveNews();
      }, 60_000);
    }
  }

  public getNews(): NewsSentimentItem[] {
    return [...this.newsItems];
  }

  public getStatus(): { count: number; isFetching: boolean; lastFetchTime: number; lastError: string | null } {
    return {
      count: this.newsItems.length,
      isFetching: this.isFetching,
      lastFetchTime: this.lastFetchTime,
      lastError: this.lastError,
    };
  }

  private async fetchFromLocalApi(): Promise<Array<{ id: string; title: string; summary: string; source: string; publishedAt: string; link?: string }> | null> {
    if (typeof window === 'undefined' || isTestRuntime()) return null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch('/api/live-news', { cache: 'no-store', signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return null;
      const data = await res.json();
      if (data?.available && Array.isArray(data.news) && data.news.length > 0) {
        return data.news;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Fetches real-time financial news from live server RSS relay or connected MT5 bridge.
   */
  public async fetchLiveNews(force = false): Promise<boolean> {
    if (this.isFetching || isTestRuntime()) return false;
    const now = Date.now();
    if (!force && now - this.lastFetchTime < 30_000) return false;

    this.isFetching = true;
    this.lastFetchTime = now;
    this.notify();

    try {
      let rawItems = await this.fetchFromLocalApi();
      if ((!rawItems || rawItems.length === 0) && mt5Bridge.getStatus().connected) {
        const bridgeItems = await mt5Bridge.fetchLiveNews();
        if (bridgeItems && bridgeItems.length > 0) {
          rawItems = bridgeItems;
        }
      }

      if (rawItems && rawItems.length > 0) {
        const processedItems: NewsSentimentItem[] = rawItems.map((raw) => {
          const scored = this.scoreHeadline(raw.title);
          const affected = this.detectAffectedAssets(raw.title);
          return {
            id: raw.id,
            title: raw.title,
            source: raw.source || 'Financial News Wire',
            publishedAt: raw.publishedAt || new Date().toISOString(),
            sentimentScore: scored.score,
            urgency: Math.abs(scored.score) >= 0.6 ? 'FLASH' : Math.abs(scored.score) >= 0.3 ? 'BREAKING' : 'ROUTINE',
            catalystType: scored.catalyst,
            affectedAssets: affected,
            summary: raw.summary || raw.title,
            link: raw.link,
          };
        });

        const existingTitles = new Set(processedItems.map((p) => p.title.toLowerCase().trim()));
        const remainingExisting = this.newsItems.filter(
          (old) => !existingTitles.has(old.title.toLowerCase().trim())
        );

        this.newsItems = [...processedItems, ...remainingExisting].slice(0, 30);
        this.lastError = null;
        this.notify();
        return true;
      }

      this.lastError = 'Live RSS news feed is temporarily unreachable.';
      this.notify();
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : 'Live news fetch error';
      this.notify();
    } finally {
      this.isFetching = false;
      this.notify();
    }
    return false;
  }

  /**
   * Fast, deterministic NLP dictionary sentiment scoring for headline text.
   */
  public scoreHeadline(title: string): { score: number; catalyst: NewsSentimentItem['catalystType'] } {
    const lower = title.toLowerCase();
    let score = 0;

    const bullishWords = [
      'surge', 'jump', 'beat', 'growth', 'climb', 'hawkish', 'inflows', 'soar',
      'rally', 'escalat', 'strong', 'higher', 'boost', 'gain', 'advance', 'outperform',
      'record high', 'rate hike', 'expansion', 'resilient'
    ];
    const bearishWords = [
      'drop', 'slump', 'miss', 'fall', 'dovish', 'cut', 'recession', 'sluggish',
      'weak', 'plunge', 'slowdown', 'lower', 'loss', 'decline', 'underperform',
      'selloff', 'downturn', 'layoffs', 'contraction', 'inflation cools'
    ];

    for (const w of bullishWords) {
      if (lower.includes(w)) score += 0.25;
    }
    for (const w of bearishWords) {
      if (lower.includes(w)) score -= 0.25;
    }

    let catalyst: NewsSentimentItem['catalystType'] = 'MARKET_FLOW';
    if (lower.includes('fed') || lower.includes('ecb') || lower.includes('rate') || lower.includes('central bank') || lower.includes('powell') || lower.includes('lagarde')) {
      catalyst = 'CENTRAL_BANK';
    } else if (lower.includes('war') || lower.includes('conflict') || lower.includes('tension') || lower.includes('tariff') || lower.includes('sanction') || lower.includes('military') || lower.includes('strait')) {
      catalyst = 'GEOPOLITICAL';
    } else if (lower.includes('cpi') || lower.includes('nfp') || lower.includes('gdp') || lower.includes('inflation') || lower.includes('pmi') || lower.includes('jobs') || lower.includes('retail sales')) {
      catalyst = 'MACRO_DATA';
    } else if (lower.includes('earnings') || lower.includes('revenue') || lower.includes('guidance') || lower.includes('profit') || lower.includes('quarter')) {
      catalyst = 'EARNINGS';
    }

    return {
      score: Math.max(-1.0, Math.min(1.0, score)),
      catalyst,
    };
  }

  public detectAffectedAssets(title: string): string[] {
    const lower = title.toLowerCase();
    const assets: string[] = [];

    if (lower.includes('gold') || lower.includes('bullion') || lower.includes('precious metal') || lower.includes('war') || lower.includes('geopolitical')) {
      assets.push('XAUUSD');
    }
    if (lower.includes('dollar') || lower.includes('fed') || lower.includes('treasury') || lower.includes('powell') || lower.includes('us ') || lower.includes('u.s.')) {
      assets.push('USD');
    }
    if (lower.includes('euro') || lower.includes('ecb') || lower.includes('germany') || lower.includes('europe')) {
      assets.push('EURUSD');
    }
    if (lower.includes('pound') || lower.includes('sterling') || lower.includes('boe') || lower.includes('uk ') || lower.includes('britain')) {
      assets.push('GBPUSD');
    }
    if (assets.length === 0) {
      assets.push('USD', 'XAUUSD');
    }
    return assets;
  }

  public addHeadline(headline: Omit<NewsSentimentItem, 'id' | 'publishedAt'>): NewsSentimentItem {
    const item: NewsSentimentItem = {
      ...headline,
      id: `manual-${Date.now()}`,
      publishedAt: new Date().toISOString(),
    };
    this.newsItems.unshift(item);
    if (this.newsItems.length > 30) {
      this.newsItems.pop();
    }
    this.notify();
    return item;
  }

  public evaluatePairSentiment(symbol: SupportedSymbol): {
    sentimentScore: number;
    sentimentBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    keyCatalyst?: string;
  } {
    let score = 0;
    let count = 0;
    let keyCatalyst: string | undefined = undefined;

    const sym = symbol.toUpperCase();
    for (const item of this.newsItems) {
      const isRelevant =
        item.affectedAssets.includes(sym) ||
        (sym === 'XAUUSD' && (item.affectedAssets.includes('XAUUSD') || item.affectedAssets.includes('USD') || item.catalystType === 'GEOPOLITICAL')) ||
        (sym.includes('USD') && item.affectedAssets.includes('USD')) ||
        (sym.includes('EUR') && item.affectedAssets.includes('EUR')) ||
        (sym.includes('GBP') && item.affectedAssets.includes('GBP')) ||
        (sym.includes('JPY') && item.affectedAssets.includes('JPY'));

      if (isRelevant) {
        let weight = item.sentimentScore;
        if (item.affectedAssets.includes('USD') && !item.affectedAssets.includes(sym)) {
          if (sym === 'EURUSD' || sym === 'GBPUSD' || sym === 'XAUUSD') {
            weight = -weight;
          }
        }
        if (sym === 'XAUUSD' && item.catalystType === 'GEOPOLITICAL') {
          weight = Math.abs(weight);
        }

        score += weight;
        count++;
        if (!keyCatalyst && (item.urgency === 'FLASH' || item.urgency === 'BREAKING')) {
          keyCatalyst = item.title;
        }
      }
    }

    const avgScore = count > 0 ? score / count : 0;
    const sentimentBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
      avgScore >= 0.20 ? 'BULLISH' : avgScore <= -0.20 ? 'BEARISH' : 'NEUTRAL';

    return {
      sentimentScore: Number(avgScore.toFixed(2)),
      sentimentBias,
      keyCatalyst: keyCatalyst || this.newsItems[0]?.title,
    };
  }

  public getGlobalSentimentIndex(): {
    score: number;
    label: 'EXTREME_BEARISH' | 'BEARISH' | 'NEUTRAL' | 'BULLISH' | 'EXTREME_BULLISH';
  } {
    if (this.newsItems.length === 0) return { score: 0, label: 'NEUTRAL' };
    const total = this.newsItems.reduce((sum, item) => sum + item.sentimentScore, 0);
    const avg = total / this.newsItems.length;
    const scaled = Math.round(avg * 100);

    let label: 'EXTREME_BEARISH' | 'BEARISH' | 'NEUTRAL' | 'BULLISH' | 'EXTREME_BULLISH' = 'NEUTRAL';
    if (scaled >= 60) label = 'EXTREME_BULLISH';
    else if (scaled >= 20) label = 'BULLISH';
    else if (scaled <= -60) label = 'EXTREME_BEARISH';
    else if (scaled <= -20) label = 'BEARISH';

    return { score: scaled, label };
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((cb) => {
      try {
        cb();
      } catch {}
    });
  }
}

export const newsSentimentEngine = new NewsSentimentEngine();
