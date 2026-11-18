# NIFTY Institutional SMC Trading Terminal & MT5 Bridge

An algorithmic Smart Money Concepts (SMC) workstation for **Gold (XAUUSD)** and major Forex pairs (**EURUSD** and **GBPUSD**). The official TradingView embed displays the chart and native technical studies; signal analysis and order execution use current, verified MetaTrader 5 (MT5) broker data.

---

## 🌟 Key Features

### 1. 📊 Broker-Verified Signal Engine
- **MT5-Only Signal Inputs**: Quotes, candles, and symbol specifications come directly from the connected local MT5 bridge. Without fresh broker data, the dashboard waits and does not create synthetic prices or signals.
- **Technical Confluence**: Order Blocks, Fair Value Gaps, BOS/CHoCH structure, and related indicators are calculated from verified broker candles.
- **SMC Indicator Overlay (ON / OFF)**: Toggle all SMC technical layers directly over the chart with a single click. When OFF, inspect naked candlestick price action; when ON, analyze institutional POIs, mitigation status, and Dealing Range equilibrium.
- **Granular Layer Controls**: Selectively enable or disable Order Blocks, Fair Value Gaps, Structure Breaks, Signal Targets, and Live Active Broker Trades.

### 2. ⚡ Direct MetaTrader 5 (MT5) Bridge & Broker Synchronization
- **Bidirectional Live Execution**: Trades executed in the terminal reflect instantaneously on your connected MT5 terminal (demo or live accounts).
- **PC-Local Broker Telemetry**: Balance, equity, margin level, and floating P&L synchronize through a high-speed Python bridge bound to `http://127.0.0.1:8000`.
- **Strategy Rationale Logging**: Every order sent to MT5 attaches institutional order block rationales and client tracking tags directly into MT5 order comments.
- **One-Click Break-Even Lock**: Lock profit on any running trade by shifting the stop loss to Entry + spread directly from the terminal.

### 3. 🌐 Real-Time Financial News & Macro Catalyst Feed
- **Live Institutional RSS/API Feeds**: The MT5 bridge parses real-time financial headlines directly from MarketWatch Top Stories and Dow Jones real-time wires with 60-second caching.
- **Deterministic High-Speed NLP Sentiment**: Real-time dictionary scoring categorizes breaking geopolitical shocks, central bank commentary, and economic surprises in under 1ms with zero LLM API rate limits, external costs, or hallucinations.
- **Direct Article Navigation**: Inspect source links directly from the news feed to read complete verified financial publications in your browser.

### 4. 🛡️ Risk Controls & Broker Preflight
- **Risk-Budget Sizing**: Volume is rounded down to the broker step. The configured adaptive minimum-lot allowance permits risk above the per-trade budget only when it stays within both $15 and 3.5% of equity; larger excesses are rejected.
- **Portfolio Stop-Risk Cap**: The MT5 bridge sums estimated downside at current stops across open positions and pending broker orders, then limits new exposure to the configured portfolio cap (3% of equity by default).
- **Fail-Closed Exposure Checks**: Missing stops or symbol risk specifications make total exposure unknown and block new orders.
- **Pre-Order Validation**: The bridge checks refreshed quotes, recalculates risk, and uses MT5 `order_check` before sending order requests.
- **Daily Loss Circuit Breaker & Kill Switch**: Independent controls block new trading when configured loss limits are reached and provide an emergency close action.

### 5. 🔊 Distinct Procedural Audio Synthesizer
- Procedural Web Audio API sound generator with zero external audio assets:
  - **Signals**: Soft harmonic crystal bell (Buy: uplifting E5→B5 chime; Sell: grounding D5→A4 chime).
  - **Precision Entries**: Separate three-note alert for strict, near-entry A+ setups.
  - **Trade Execution**: Mechanical order fill click + rising confirmation blip.
  - **Profits**: Triumphant ascending 4-note major arpeggio (C5 → E5 → G5 → C6).
  - **Losses**: Subdued descending warning tone (D4 → A3).

### 5. 🖥️ PC-Only Workspace
- **Local-Only Dashboard and Bridge**: The dashboard and MT5 bridge bind to loopback addresses on the Windows PC; remote bridge access is disabled.
- **Precision Entry Alerts**: Telegram and the popup use a strict A+ near-OTE qualification tier with structural, POI, momentum, spread, risk, and expiry checks. A separate approaching-trigger alert is informational only and does not place an order.
- **More Regular Setup Candidates**: Regular closed-candle signal scoring is modestly more permissive (4.5/10); multi-pair score gates are 65/100 (70 for GBPUSD). Fresh active-pair scanner candidates flow into the Signal Engine on a consistent 0-10 score scale; non-ready candidates remain visible with their block reason and cannot execute. Auto-execution still requires its separate 6/10 minimum plus risk, spread, news, expiry, and broker checks. If calendar data is unavailable, candidates remain visible but standard MT5 execution is held. Precision Entry alerts retain their strict A+ threshold.
- **Economic Calendar**: Upcoming USD, EUR, GBP, and JPY events are fetched server-side from the Forex Factory weekly calendar, with Finnhub used as an optional fallback when `FINNHUB_API_KEY` is configured. Missing or failed calendar data keeps standard scanner candidates blocked; a successfully fetched empty calendar is treated as no upcoming events.
- **Live World News**: A local-bridge service aggregates a curated sample of public Google News, BBC, and CNBC RSS feeds across world, business, economy, and currency topics. The dashboard refreshes headlines every 60 seconds and links to the original publishers. Keyword-based tone and impact labels are heuristics, not verified market analysis or comprehensive global coverage. Live headline impact is off by default; an explicit dashboard setting enables headline-based scanner adjustments and auto-trade blocks. Scheduled economic-calendar checks remain a separate safeguard. The feed does not read TradingView chart signals.
- **Automatic Expiry**: Signal entry windows are tied to the source candle close and expired signals are removed from the feed and popup.
- **Distinct Sound Previews**: Signal, precision, trade, profit, and loss sounds can be auditioned separately from the safety bar.

### 6. 📈 Signal Quality & System Health
- **Feed Diagnostics**: The dashboard shows broker quote/candle freshness and scanner readiness/rejection reasons.
- **Versioned Signal Scores**: Signal scores use a consistent 0–100 scale (policy v2); weighted scanner components and their raw total remain available separately from the capped normalized score.
- **Closed-Trade Statistics**: Win rate, broker-reported net P&L, profit factor, and average outcome are calculated from observed closed MT5 deal history.
- **Prospective Signal Validation**: A local journal logs READY signal triggers using closed broker M1 candles that begin no earlier than the signal's availability time.
- **Compact Account Scanner**: Broker balance, equity, and free margin remain visible on narrow screens; scanner cards start compact and expand on demand.

---

## 🏗️ Architecture & Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons.
- **State Architecture**: Fine-grained subscription channels via `useSyncExternalStore` for microsecond render stability.
- **Charting**: Official TradingView Advanced Chart embed with configurable native EMA, RSI, and MACD studies.
- **Market Data**: TradingView supplies the displayed chart; the local MT5 bridge supplies signal calculations and execution quotes. Custom SMC drawings are not injected into the TradingView embed.
- **Audio Engine**: Native procedural Web Audio API with oscillators, biquad lowpass filters, and exponential gain ramping.
- **Broker Bridge**: Python 3 `MetaTrader5` socket bridge / REST bridge compatible with standard MT5 Windows installations.

---

## 🚀 Quick Start Guide

### Prerequisites
- Node.js 22+ and npm
- Python and MetaTrader 5 installed on the same Windows PC (for live broker execution)

### 1. Install & Run on the PC
```bash
# Clone the repository
git clone https://github.com/nick12530/FDO.git
cd FDO

# Install dependencies
npm install

# Start the PC-only bridge and dashboard
powershell -ExecutionPolicy Bypass -File .\mt5-bridge\start_pc.ps1
```

### 2. Connect MetaTrader 5
1. Open MT5 Desktop and sign in to your demo or live account.
2. Start the local bridge server via `start_pc.ps1` or `python mt5-bridge/server.py`.
3. In the terminal header, click **MT5 Bridge** to verify connectivity.
4. Confirm live quotes and telemetry appear in the terminal.
