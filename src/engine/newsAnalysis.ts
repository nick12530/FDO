/**
 * newsAnalysis.ts - Live headline sentiment & FX impact scoring
 * Heuristically summarizes world/economic/political/financial headlines.
 * This is context for MT5-derived signals, not a predictive model.
 */

import type { SupportedSymbol } from './instrumentConfig';
import type { TradeDirection } from '../types/smc';

export type NewsCategory = 'economic' | 'political' | 'financial' | 'general';

export interface WorldNewsItem {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  category: NewsCategory;
  publishedAt: string;
  sentiment?: number; // -1 .. +1 keyword-tone heuristic
  currencies?: Array<'USD' | 'EUR' | 'GBP' | 'JPY' | 'XAU'>;
}

export interface CurrencyNewsBias {
  currency: 'USD' | 'EUR' | 'GBP' | 'JPY' | 'XAU';
  score: number; // -100 .. +100 (positive = bullish for that asset)
  headlineCount: number;
  topDrivers: string[];
}

export interface NewsMarketAnalysis {
  updatedAt: number;
  itemCount: number;
  riskLevel: 'calm' | 'elevated' | 'high' | 'extreme';
  highImpactCount: number;
  uncertainHeadlineCount: number;
  summary: string;
  currencyBias: Record<'USD' | 'EUR' | 'GBP' | 'JPY' | 'XAU', CurrencyNewsBias>;
  blockingReason?: string;
  topHeadlines: WorldNewsItem[];
}

const BULLISH_WORDS = [
  'surge', 'rally', 'soar', 'gain', 'strong', 'beat', 'hawkish', 'hike', 'growth',
  'recovery', 'optimism', 'record high', 'upbeat', 'resilient', 'expansion', 'tightening',
];
const BEARISH_WORDS = [
  'fall', 'drop', 'plunge', 'weak', 'miss', 'dovish', 'cut', 'recession', 'crisis',
  'sanction', 'war', 'conflict', 'default', 'collapse', 'selloff', 'slump', 'fear',
  'risk-off', 'downgrade', 'shock',
];
const EXTREME_RISK_WORDS = [
  'emergency rate decision', 'bank failure', 'market halt', 'nuclear attack',
  'military invasion', 'flash crash', 'black swan', 'martial law',
];
const HIGH_IMPACT_WORDS = [
  'rate decision', 'interest rate', 'central bank', 'federal reserve', 'fomc',
  'ecb', 'bank of england', 'bank of japan', 'inflation', 'cpi', 'payroll',
  'nonfarm', 'unemployment', 'gdp', 'war', 'airstrike', 'sanctions', 'election',
  'coup', 'bank failure', 'default', 'market crash', 'trading halt',
];
const UNCERTAINTY_WORDS = ['unconfirmed', 'unverified', 'rumor', 'rumour', 'alleged'];
const HIGH_IMPACT_WINDOW_MS = 30 * 60_000;
export const MAX_WORLD_NEWS_AGE_MS = 3 * 60_000;

const CURRENCY_KEYWORDS: Record<'USD' | 'EUR' | 'GBP' | 'JPY' | 'XAU', string[]> = {
  USD: ['usd', 'dollar', 'fed', 'fomc', 'powell', 'u.s.', 'us ', 'united states', 'treasury', 'nfp', 'cpi'],
  EUR: ['eur', 'euro', 'ecb', 'lagarde', 'eurozone', 'euro zone', 'germany', 'france'],
  GBP: ['gbp', 'pound', 'sterling', 'boe', 'bank of england', 'uk ', 'britain', 'gilt'],
  JPY: ['jpy', 'yen', 'boj', 'bank of japan', 'tokyo', 'japan'],
  XAU: ['gold', 'xau', 'bullion', 'precious metal'],
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scoreTextSentiment(text: string): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const word of BULLISH_WORDS) {
    if (lower.includes(word)) score += 1;
  }
  for (const word of BEARISH_WORDS) {
    if (lower.includes(word)) score -= 1;
  }
  return clamp(score / 4, -1, 1);
}

function detectCurrencies(text: string): Array<'USD' | 'EUR' | 'GBP' | 'JPY' | 'XAU'> {
  const lower = text.toLowerCase();
  const found: Array<'USD' | 'EUR' | 'GBP' | 'JPY' | 'XAU'> = [];
  (Object.keys(CURRENCY_KEYWORDS) as Array<'USD' | 'EUR' | 'GBP' | 'JPY' | 'XAU'>).forEach((currency) => {
    if (CURRENCY_KEYWORDS[currency].some((keyword) => lower.includes(keyword))) {
      found.push(currency);
    }
  });
  return found;
}

function isExtremeRisk(text: string): boolean {
  const lower = text.toLowerCase();
  return EXTREME_RISK_WORDS.some((word) => lower.includes(word));
}

export function enrichNewsItem(item: WorldNewsItem): WorldNewsItem {
  const blob = `${item.title} ${item.summary}`;
  return {
    ...item,
    sentiment: scoreTextSentiment(blob),
    currencies: detectCurrencies(blob),
  };
}

function emptyBias(currency: CurrencyNewsBias['currency']): CurrencyNewsBias {
  return { currency, score: 0, headlineCount: 0, topDrivers: [] };
}

/**
 * Aggregate headline sentiment into per-currency bias and market risk level.
 */
export function analyzeWorldNews(items: WorldNewsItem[], now = Date.now()): NewsMarketAnalysis {
  const enriched = items.map(enrichNewsItem);
  const currencyBias: NewsMarketAnalysis['currencyBias'] = {
    USD: emptyBias('USD'),
    EUR: emptyBias('EUR'),
    GBP: emptyBias('GBP'),
    JPY: emptyBias('JPY'),
    XAU: emptyBias('XAU'),
  };

  let extremeHits = 0;
  let highImpactHits = 0;
  let uncertainHeadlineCount = 0;

  for (const item of enriched) {
    const publishedAt = Date.parse(item.publishedAt || '');
    const ageMs = now - publishedAt;
    if (!Number.isFinite(publishedAt) || ageMs < 0 || ageMs > 24 * 60 * 60_000) continue;
    const freshness = Number.isFinite(ageMs) ? clamp(1 - ageMs / (6 * 60 * 60 * 1000), 0.25, 1) : 0.5;
    const weight = (item.category === 'economic' ? 1.25 : item.category === 'political' ? 1.1 : 1) * freshness;
    const sentiment = (item.sentiment ?? 0) * weight * 40;

    for (const currency of item.currencies ?? []) {
      const bucket = currencyBias[currency];
      bucket.score += sentiment;
      bucket.headlineCount += 1;
      if (bucket.topDrivers.length < 3) {
        bucket.topDrivers.push(item.title);
      }
    }

    const text = `${item.title} ${item.summary}`.toLowerCase();
    const isRecent = ageMs <= HIGH_IMPACT_WINDOW_MS;
    const isHighImpact = isRecent && HIGH_IMPACT_WORDS.some((word) => text.includes(word));
    if (isHighImpact) highImpactHits += 1;
    if (
      isHighImpact &&
      UNCERTAINTY_WORDS.some((word) => text.includes(word))
    ) {
      uncertainHeadlineCount += 1;
    }
    if (ageMs <= HIGH_IMPACT_WINDOW_MS * 2 && isExtremeRisk(text)) {
      extremeHits += 1;
    }
  }

  (Object.keys(currencyBias) as Array<keyof typeof currencyBias>).forEach((key) => {
    currencyBias[key].score = Number(clamp(currencyBias[key].score, -100, 100).toFixed(1));
  });

  let riskLevel: NewsMarketAnalysis['riskLevel'] = 'calm';
  if (extremeHits > 0) riskLevel = 'extreme';
  else if (highImpactHits > 0) riskLevel = 'high';
  else if (uncertainHeadlineCount > 0) riskLevel = 'elevated';

  const usd = currencyBias.USD.score;
  const summaryParts = [
    `Live news pulse: ${enriched.length} headlines`,
    `USD bias ${usd >= 0 ? '+' : ''}${usd.toFixed(0)}`,
    `Gold bias ${currencyBias.XAU.score >= 0 ? '+' : ''}${currencyBias.XAU.score.toFixed(0)}`,
    `High impact ${highImpactHits}`,
    `Uncertain ${uncertainHeadlineCount}`,
    `Risk ${riskLevel.toUpperCase()}`,
  ];

  const analysis: NewsMarketAnalysis = {
    updatedAt: now,
    itemCount: enriched.length,
    riskLevel,
    highImpactCount: highImpactHits,
    uncertainHeadlineCount,
    summary: summaryParts.join(' · '),
    currencyBias,
    topHeadlines: enriched.slice(0, 12),
  };

  if (riskLevel === 'extreme') {
    analysis.blockingReason = 'NEWS FILTER: EXTREME MARKET / GEOPOLITICAL HEADLINE';
  } else if (uncertainHeadlineCount > 0) {
    analysis.blockingReason = 'NEWS FILTER: UNCERTAIN HIGH-IMPACT HEADLINE';
  } else if (highImpactHits > 0) {
    analysis.blockingReason = `NEWS FILTER: ${highImpactHits} RECENT HIGH-IMPACT HEADLINE(S)`;
  }

  return analysis;
}

/**
 * Translate absolute currency biases into a directional lean for a FX/metal pair.
 * Positive = favours BUY, negative = favours SELL.
 */
export function pairNewsBiasScore(symbol: SupportedSymbol, analysis: NewsMarketAnalysis | null): number {
  if (!analysis) return 0;
  const bias = analysis.currencyBias;
  switch (symbol) {
    case 'EURUSD':
      return Number((bias.EUR.score - bias.USD.score).toFixed(1));
    case 'GBPUSD':
      return Number((bias.GBP.score - bias.USD.score).toFixed(1));
    case 'XAUUSD':
      // Gold often rises on USD weakness / risk-off — blend both
      return Number((bias.XAU.score - bias.USD.score * 0.6).toFixed(1));
    default:
      return 0;
  }
}

export interface NewsSignalDecision {
  aligned: boolean;
  conflicting: boolean;
  scoreAdjustment: number; // confluence points (-10 .. +8)
  statusHint?: 'BLOCKED' | 'CAUTION';
  reason?: string;
}

/**
 * Combine live news bias with an MT5-candle/SMC directional signal.
 */
export function evaluateNewsSignalConfluence(
  symbol: SupportedSymbol,
  direction: TradeDirection | 'WAITING',
  analysis: NewsMarketAnalysis | null
): NewsSignalDecision {
  if (!analysis || direction === 'WAITING') {
    return { aligned: false, conflicting: false, scoreAdjustment: 0 };
  }

  if (analysis.blockingReason) {
    return {
      aligned: false,
      conflicting: false,
      scoreAdjustment: 0,
      statusHint: 'CAUTION',
      reason: analysis.blockingReason,
    };
  }

  const lean = pairNewsBiasScore(symbol, analysis);
  const favoursBuy = lean >= 18;
  const favoursSell = lean <= -18;
  const mildBuy = lean >= 8;
  const mildSell = lean <= -8;

  if (direction === 'BUY' && favoursBuy) {
    return {
      aligned: true,
      conflicting: false,
      scoreAdjustment: analysis.riskLevel === 'high' ? 4 : 8,
      reason: `NEWS ALIGNED: headline bias +${lean} supports BUY`,
    };
  }
  if (direction === 'SELL' && favoursSell) {
    return {
      aligned: true,
      conflicting: false,
      scoreAdjustment: analysis.riskLevel === 'high' ? 4 : 8,
      reason: `NEWS ALIGNED: headline bias ${lean} supports SELL`,
    };
  }
  if (direction === 'BUY' && favoursSell) {
    return {
      aligned: false,
      conflicting: true,
      scoreAdjustment: -8,
      statusHint: analysis.riskLevel === 'high' || analysis.riskLevel === 'extreme' ? 'BLOCKED' : undefined,
      reason: `NEWS CONFLICT: headline bias ${lean} opposes BUY`,
    };
  }
  if (direction === 'SELL' && favoursBuy) {
    return {
      aligned: false,
      conflicting: true,
      scoreAdjustment: -8,
      statusHint: analysis.riskLevel === 'high' || analysis.riskLevel === 'extreme' ? 'BLOCKED' : undefined,
      reason: `NEWS CONFLICT: headline bias +${lean} opposes SELL`,
    };
  }
  if ((direction === 'BUY' && mildBuy) || (direction === 'SELL' && mildSell)) {
    return {
      aligned: true,
      conflicting: false,
      scoreAdjustment: 3,
      reason: `NEWS SUPPORTIVE: mild headline lean ${lean >= 0 ? '+' : ''}${lean}`,
    };
  }

  if (analysis.riskLevel === 'high') {
    return {
      aligned: false,
      conflicting: false,
      scoreAdjustment: -3,
      reason: 'NEWS CAUTION: elevated macro/political headline flow',
    };
  }

  return { aligned: false, conflicting: false, scoreAdjustment: 0 };
}

export function getWorldNewsAutoTradeBlockReason(
  analysis: NewsMarketAnalysis | null,
  now = Date.now()
): string | null {
  if (
    !analysis ||
    !Number.isFinite(analysis.updatedAt) ||
    analysis.updatedAt > now + 5_000 ||
    now - analysis.updatedAt > MAX_WORLD_NEWS_AGE_MS
  ) {
    return 'TRADE_REJECTED: WORLD_NEWS_DATA_UNAVAILABLE_OR_STALE';
  }
  return analysis.blockingReason ? `TRADE_REJECTED: ${analysis.blockingReason}` : null;
}
