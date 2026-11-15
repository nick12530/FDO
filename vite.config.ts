import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

import fs from 'fs';
import os from 'os';

function resolveBridgeToken(): string {
  const envToken = process.env.SMC_BRIDGE_TOKEN?.trim();
  if (envToken) return envToken;

  try {
    const localAppData =
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const tokenFile = path.join(localAppData, 'SMCBridge', 'bridge_token.txt');
    if (fs.existsSync(tokenFile)) {
      const stored = fs.readFileSync(tokenFile, 'utf-8').trim();
      if (stored) return stored;
    }
  } catch {
    // Ignore errors reading local file
  }

  try {
    const homeTokenFile = path.join(os.homedir(), '.smcbridge', 'bridge_token.txt');
    if (fs.existsSync(homeTokenFile)) {
      const stored = fs.readFileSync(homeTokenFile, 'utf-8').trim();
      if (stored) return stored;
    }
  } catch {}

  return '';
}

const bridgePort = process.env.SMC_BRIDGE_PORT || '8000';
const mt5Proxy = {
  '/mt5-bridge': {
    target: `http://127.0.0.1:${bridgePort}`,
    changeOrigin: true,
    rewrite: (requestPath: string) => requestPath.replace(/^\/mt5-bridge/, ''),
    configure: (proxy: any) => {
      proxy.on('proxyReq', (proxyReq: any) => {
        const token = resolveBridgeToken();
        if (token && !proxyReq.getHeader('authorization')) {
          proxyReq.setHeader('authorization', `Bearer ${token}`);
        }
      });
    },
  },
};

function decodeXmlText(input: string): string {
  return input
    .replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXmlText(match[1]) : '';
}

let cachedNewsPayload: { fetchedAt: number; news: any[] } | null = null;

function registerLocalApiRoutes(middlewares: any) {
  middlewares.use('/api/live-news', async (req: any, res: any, next: any) => {
    if (req.method !== 'GET') return next();
    res.setHeader('Content-Type', 'application/json');

    const now = Date.now();
    if (cachedNewsPayload && now - cachedNewsPayload.fetchedAt < 60_000 && cachedNewsPayload.news.length > 0) {
      res.end(JSON.stringify({ available: true, news: cachedNewsPayload.news, updatedAt: new Date(cachedNewsPayload.fetchedAt).toISOString() }));
      return;
    }

    const rssUrls = [
      { source: 'MarketWatch Top Stories', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
      { source: 'MarketWatch Real-time', url: 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines' },
    ];
    const items: any[] = [];
    const seen = new Set<string>();

    for (const feed of rssUrls) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 7000);
        const upstream = await fetch(feed.url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'NIFTY-Terminal/1.0', Accept: 'application/xml, text/xml, application/rss+xml' },
        });
        clearTimeout(timer);
        if (!upstream.ok) continue;
        const xml = await upstream.text();
        const rawItems = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
        for (const rawItem of rawItems) {
          const title = extractTag(rawItem, 'title');
          if (!title || title.length <= 5) continue;
          const key = title.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);

          const summary = extractTag(rawItem, 'description') || title;
          const link = extractTag(rawItem, 'link');
          const pubDate = extractTag(rawItem, 'pubDate');
          const guid = extractTag(rawItem, 'guid') || title.slice(0, 32);

          items.push({
            id: `rss:${guid}`,
            title,
            summary,
            source: feed.source,
            publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
            link: link || undefined,
          });
          if (items.length >= 20) break;
        }
        if (items.length >= 15) break;
      } catch {
        continue;
      }
    }

    if (items.length > 0) {
      cachedNewsPayload = { fetchedAt: Date.now(), news: items };
      res.end(JSON.stringify({ available: true, news: items, updatedAt: new Date().toISOString() }));
    } else {
      res.statusCode = 503;
      res.end(JSON.stringify({ available: false, news: [], message: 'Live financial news feeds are currently unreachable' }));
    }
  });

  middlewares.use('/api/telegram/send', async (req: any, res: any, next: any) => {
    if (req.method !== 'POST') return next();
    res.setHeader('Content-Type', 'application/json');
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
      const botToken = String(body.botToken || '').trim().replace(/^bot/i, '');
      const chatId = String(body.chatId || '').trim();
      const text = String(body.text || '').trim();
      if (!botToken || !chatId || !text) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'Telegram Bot Token, Chat ID, and message text are required.' }));
        return;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: body.parseMode || 'HTML',
          disable_web_page_preview: true,
        }),
      });
      clearTimeout(timer);
      const tgData: any = await tgRes.json().catch(() => ({}));
      if (!tgRes.ok || !tgData.ok) {
        res.statusCode = tgRes.status >= 400 ? tgRes.status : 502;
        res.end(JSON.stringify({ ok: false, error: tgData?.description || `Telegram HTTP ${tgRes.status}` }));
        return;
      }
      res.end(JSON.stringify({ ok: true, result: tgData.result }));
    } catch (err: any) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Telegram relay request failed' }));
    }
  });

  middlewares.use('/api/webhook/send', async (req: any, res: any, next: any) => {
    if (req.method !== 'POST') return next();
    res.setHeader('Content-Type', 'application/json');
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
      const targetUrl = String(body.url || '').trim();
      if (!/^https?:\/\//i.test(targetUrl)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'Valid http(s) Webhook URL is required.' }));
        return;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const upstream = await fetch(targetUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body.payload ?? {}),
      });
      clearTimeout(timer);
      if (!upstream.ok) {
        const errText = await upstream.text().catch(() => '');
        res.statusCode = upstream.status;
        res.end(JSON.stringify({ ok: false, error: errText.slice(0, 160) || `Webhook HTTP ${upstream.status}` }));
        return;
      }
      res.end(JSON.stringify({ ok: true }));
    } catch (err: any) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Webhook relay request failed' }));
    }
  });
}

const localApiPlugin = () => ({
  name: 'nifty-local-api',
  configureServer(server: any) {
    registerLocalApiRoutes(server.middlewares);
  },
  configurePreviewServer(server: any) {
    registerLocalApiRoutes(server.middlewares);
  },
});

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), localApiPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true as true,
      proxy: mt5Proxy,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    preview: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true as true,
      proxy: mt5Proxy,
    },
  };
});

