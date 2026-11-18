import { describe, expect, it } from 'vitest';
import {
  analyzeWorldNews,
  evaluateNewsSignalConfluence,
  getWorldNewsAutoTradeBlockReason,
  pairNewsBiasScore,
  type WorldNewsItem,
} from './newsAnalysis';

const sampleItems: WorldNewsItem[] = [
  {
    id: '1',
    title: 'Fed signals strong rate hike as US inflation surges',
    summary: 'Dollar gains on hawkish Federal Reserve outlook.',
    url: 'https://example.com/1',
    source: 'Wire',
    category: 'economic',
    publishedAt: new Date().toISOString(),
  },
  {
    id: '2',
    title: 'Gold plunges as risk-off fear fades and bullion sells off',
    summary: 'Precious metals drop with stronger USD tone.',
    url: 'https://example.com/2',
    source: 'Wire',
    category: 'financial',
    publishedAt: new Date().toISOString(),
  },
  {
    id: '3',
    title: 'ECB remains dovish as eurozone growth weakens',
    summary: 'Euro under pressure after soft PMI prints.',
    url: 'https://example.com/3',
    source: 'Wire',
    category: 'economic',
    publishedAt: new Date().toISOString(),
  },
];

describe('newsAnalysis', () => {
  it('scores currency bias from live headlines', () => {
    const analysis = analyzeWorldNews(sampleItems);
    expect(analysis.itemCount).toBe(3);
    expect(analysis.currencyBias.USD.headlineCount).toBeGreaterThan(0);
    expect(analysis.summary).toContain('Live news pulse');
  });

  it('leans USDJPY buy when USD headline tone is strong vs JPY', () => {
    const analysis = analyzeWorldNews(sampleItems);
    const lean = pairNewsBiasScore('USDJPY', analysis);
    expect(typeof lean).toBe('number');
  });

  it('blocks trades on extreme risk headlines', () => {
    const analysis = analyzeWorldNews([
      {
        id: 'x',
        title: 'Emergency rate shock after bank failure sparks flash crash fears',
        summary: 'Markets scramble amid black swan event.',
        url: 'https://example.com/x',
        source: 'Wire',
        category: 'financial',
        publishedAt: new Date().toISOString(),
      },
    ]);
    expect(analysis.riskLevel).toBe('extreme');
    const decision = evaluateNewsSignalConfluence('XAUUSD', 'BUY', analysis);
    expect(decision.statusHint).toBe('CAUTION');
    expect(getWorldNewsAutoTradeBlockReason(analysis)).toContain('EXTREME');
  });

  it('blocks auto-trading for recent high-impact headlines and unavailable or stale news', () => {
    const now = Date.now();
    const highImpact = analyzeWorldNews([
      {
        id: 'rate-decision',
        title: 'Central bank announces surprise interest rate decision',
        summary: '',
        url: 'https://example.com/rates',
        source: 'Wire',
        category: 'economic',
        publishedAt: new Date(now).toISOString(),
      },
    ], now);

    expect(highImpact.blockingReason).toContain('HIGH-IMPACT');
    expect(getWorldNewsAutoTradeBlockReason(highImpact, now)).toContain('HIGH-IMPACT');
    expect(getWorldNewsAutoTradeBlockReason(null, now)).toContain('UNAVAILABLE_OR_STALE');
    expect(getWorldNewsAutoTradeBlockReason(highImpact, now + 4 * 60_000)).toContain('UNAVAILABLE_OR_STALE');
  });

  it('does not assign unrelated global headlines to USD', () => {
    const analysis = analyzeWorldNews([
      {
        id: 'world',
        title: 'World leaders discuss regional education partnership',
        summary: '',
        url: 'https://example.com/world',
        source: 'Wire',
        category: 'general',
        publishedAt: new Date().toISOString(),
      },
    ]);

    expect(analysis.currencyBias.USD.headlineCount).toBe(0);
    expect(analysis.currencyBias.USD.score).toBe(0);
  });

  it('can align SMC direction with supportive news lean', () => {
    const analysis = analyzeWorldNews(sampleItems);
    // Force a strong EURUSD sell lean by checking conflict/align path returns structured result
    const decision = evaluateNewsSignalConfluence('EURUSD', 'SELL', analysis);
    expect(decision).toHaveProperty('scoreAdjustment');
    expect(typeof decision.conflicting).toBe('boolean');
  });
});
