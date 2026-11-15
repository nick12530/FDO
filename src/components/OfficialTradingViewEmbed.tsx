/**
 * OfficialTradingViewEmbed.tsx - Institutional Real-Time TradingView Advanced Chart
 * Syncs symbol, timeframe, dark/light surfaces, and TradingView technical studies cleanly.
 */

import React, { memo, useMemo } from 'react';

interface OfficialTradingViewEmbedProps {
  symbol: string;
  isDark?: boolean;
  interval?: '1' | '5' | '15' | '60' | '240' | 'D';
  height?: number | string;
  studies?: string[];
}

export const OfficialTradingViewEmbed: React.FC<OfficialTradingViewEmbedProps> = memo(({
  symbol = 'OANDA:XAUUSD',
  isDark = true,
  interval = '1',
  height = '100%',
  studies = [],
}) => {
  const formattedSymbol = useMemo(() => {
    if (symbol.includes(':')) return symbol;
    if (symbol.toUpperCase() === 'XAUUSD') return 'OANDA:XAUUSD';
    return `FX:${symbol.toUpperCase()}`;
  }, [symbol]);

  const studiesKey = studies.join('|');

  const iframeSrc = useMemo(() => {
    const widgetConfig: Record<string, unknown> = {
      autosize: true,
      symbol: formattedSymbol,
      interval,
      timezone: 'Etc/UTC',
      theme: isDark ? 'dark' : 'light',
      style: '1',
      enable_publishing: false,
      allow_symbol_change: false,
      calendar: false,
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: true,
      backgroundColor: isDark ? '#0f172a' : '#ffffff',
      gridColor: isDark ? 'rgba(51, 65, 85, 0.35)' : 'rgba(203, 213, 225, 0.7)',
      support_host: 'https://www.tradingview.com',
      width: '100%',
      height: '100%',
    };

    if (studies.length > 0) {
      widgetConfig.studies = studies;
    }

    const url = new URL('https://www.tradingview-widget.com/embed-widget/advanced-chart/');
    url.searchParams.set('locale', 'en');
    if (typeof window !== 'undefined' && window.location.hostname) {
      url.searchParams.set('utm_source', window.location.hostname);
    }
    url.searchParams.set('utm_medium', 'widget');
    url.searchParams.set('utm_campaign', 'advanced-chart');
    url.hash = encodeURIComponent(JSON.stringify(widgetConfig));
    return url.toString();
  }, [formattedSymbol, interval, isDark, studiesKey]);

  return (
    <div
      className={`w-full h-full min-h-[380px] relative overflow-hidden ${isDark ? 'bg-[#0f172a]' : 'bg-white'}`}
      style={{ height: typeof height === 'number' ? `${height}px` : height }}
    >
      <iframe
        key={iframeSrc}
        title={`TradingView Advanced Chart (${formattedSymbol})`}
        src={iframeSrc}
        className="w-full h-full border-0 block select-none"
        style={{ width: '100%', height: '100%' }}
        allowFullScreen
        loading="eager"
      />
    </div>
  );
});
