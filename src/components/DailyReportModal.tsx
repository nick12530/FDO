/**
 * DailyReportModal.tsx - Minimalist Daily Performance Report
 * - Strictly driven by real account-scoped closedTrades & live account state (zero mock fallbacks)
 * - Supports date switching, outcome/direction filtering, symbol-accurate price decimals, and CSV/clipboard export
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useClosedTrades, useEngine, useTicker } from '../hooks/useTradingStore';
import { tradingEngine } from '../engine/tradingEngine';
import { closedTradeDayKey, localDayKey } from '../engine/tradeJournal';
import { getInstrumentConfig, SupportedSymbol } from '../engine/instrumentConfig';
import {
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Search,
  X,
} from 'lucide-react';

interface DailyReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate?: string;
}

export const DailyReportModal: React.FC<DailyReportModalProps> = ({
  isOpen,
  onClose,
  selectedDate = localDayKey(new Date()),
}) => {
  const closedTrades = useClosedTrades();
  const ticker = useTicker();
  const engine = useEngine();
  const [activeDate, setActiveDate] = useState(selectedDate);
  const [copied, setCopied] = useState(false);

  const [outcomeFilter, setOutcomeFilter] = useState<'ALL' | 'WIN' | 'LOSS'>('ALL');
  const [directionFilter, setDirectionFilter] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    setActiveDate(selectedDate);
  }, [selectedDate]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const mt5 = engine.mt5Account;
  const accountLabel = mt5?.connected ? `MT5 #${mt5.login} · ${mt5.server}` : 'No MT5 Account Connected';

  const stats = useMemo(() => {
    const dayTrades = closedTrades.filter((trade) => closedTradeDayKey(trade) === activeDate);
    const totalCount = dayTrades.length;
    const winningTrades = dayTrades.filter((t) => t.profit > 0);
    const losingTrades = dayTrades.filter((t) => t.profit < 0);
    const winCount = winningTrades.length;
    const lossCount = losingTrades.length;
    const winRate = totalCount > 0 ? ((winCount / totalCount) * 100).toFixed(1) : '0.0';

    const grossProfit = winningTrades.reduce((acc, t) => acc + t.profit, 0);
    const grossLoss = Math.abs(losingTrades.reduce((acc, t) => acc + t.profit, 0));
    const netPnl = Number((grossProfit - grossLoss).toFixed(2));
    const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? 'MAX' : '0.00';

    const totalVolume = dayTrades.reduce((acc, t) => acc + t.volume, 0);
    const totalPips = dayTrades.reduce((acc, t) => acc + t.pips, 0);

    const avgWin = winCount > 0 ? (grossProfit / winCount).toFixed(2) : '0.00';
    const avgLoss = lossCount > 0 ? (grossLoss / lossCount).toFixed(2) : '0.00';

    const longTrades = dayTrades.filter((t) => t.type === 'BUY');
    const shortTrades = dayTrades.filter((t) => t.type === 'SELL');
    const longWins = longTrades.filter((t) => t.profit > 0).length;
    const shortWins = shortTrades.filter((t) => t.profit > 0).length;
    const longWinRate = longTrades.length > 0 ? ((longWins / longTrades.length) * 100).toFixed(0) : '0';
    const shortWinRate = shortTrades.length > 0 ? ((shortWins / shortTrades.length) * 100).toFixed(0) : '0';

    const startBalance =
      tradingEngine.account.daily_start_balance > 0
        ? tradingEngine.account.daily_start_balance
        : ticker.balance > 0
          ? Math.max(1, ticker.balance - netPnl)
          : 0;
    const returnPct = startBalance > 0 ? ((netPnl / startBalance) * 100).toFixed(2) : '0.00';

    return {
      dayTrades,
      totalCount,
      winCount,
      lossCount,
      winRate,
      grossProfit: grossProfit.toFixed(2),
      grossLoss: grossLoss.toFixed(2),
      netPnl,
      profitFactor,
      totalVolume: totalVolume.toFixed(2),
      totalPips: totalPips.toFixed(1),
      avgWin,
      avgLoss,
      longCount: longTrades.length,
      shortCount: shortTrades.length,
      longWinRate,
      shortWinRate,
      returnPct,
    };
  }, [closedTrades, activeDate, ticker.balance]);

  const filteredTrades = useMemo(() => {
    return stats.dayTrades.filter((t) => {
      if (outcomeFilter === 'WIN' && t.profit <= 0) return false;
      if (outcomeFilter === 'LOSS' && t.profit >= 0) return false;
      if (directionFilter === 'BUY' && t.type !== 'BUY') return false;
      if (directionFilter === 'SELL' && t.type !== 'SELL') return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchSymbol = (t.symbol || '').toLowerCase().includes(q);
        const matchTicket = t.ticket.toString().includes(q);
        const matchReason = t.reason.toLowerCase().includes(q);
        const matchComment = t.comment ? t.comment.toLowerCase().includes(q) : false;
        const matchRationale = t.strategyRationale ? t.strategyRationale.toLowerCase().includes(q) : false;
        if (!matchSymbol && !matchTicket && !matchReason && !matchComment && !matchRationale) return false;
      }
      return true;
    });
  }, [stats.dayTrades, outcomeFilter, directionFilter, searchQuery]);

  const shiftDate = (deltaDays: number) => {
    const d = new Date(`${activeDate}T12:00:00`);
    if (Number.isNaN(d.getTime())) return;
    d.setDate(d.getDate() + deltaDays);
    setActiveDate(localDayKey(d));
  };

  const handleCopyReport = () => {
    const reportText = `===========================================
NIFTY TERMINAL - DAILY PERFORMANCE REPORT
Account:         ${accountLabel}
Session Date:    ${activeDate} (Local)
-------------------------------------------
Net Realized PnL:   ${stats.netPnl >= 0 ? '+' : ''}$${stats.netPnl.toFixed(2)} USD (${stats.returnPct}%)
Total Trades:       ${stats.totalCount} (${stats.winCount}W / ${stats.lossCount}L)
Win Rate:           ${stats.winRate}%
Profit Factor:      ${stats.profitFactor}
Total Pips:         ${stats.totalPips} pips
Volume Executed:    ${stats.totalVolume} Lots
Avg Win / Loss:     +$${stats.avgWin} / -$${stats.avgLoss}
Long Win Rate:      ${stats.longWinRate}% (${stats.longCount} trades)
Short Win Rate:     ${stats.shortWinRate}% (${stats.shortCount} trades)
Current Equity:     $${ticker.equity.toFixed(2)}
Daily Drawdown:     ${tradingEngine.account.daily_drawdown_pct}% (Max: ${tradingEngine.account.max_daily_loss_pct}%)
===========================================`;

    navigator.clipboard.writeText(reportText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  const handleDownloadCSV = () => {
    if (stats.dayTrades.length === 0) return;
    const headers = ['Ticket', 'Symbol', 'CloseAt', 'Type', 'Volume', 'OpenPrice', 'ClosePrice', 'Pips', 'Profit', 'Reason', 'StrategyRationale'];
    const rows = stats.dayTrades.map((t) => {
      const sym = (t.symbol || 'XAUUSD') as SupportedSymbol;
      const d = getInstrumentConfig(sym).digits;
      return [
        t.ticket,
        t.symbol || '',
        t.closedAt || t.closeTime || '',
        t.type,
        t.volume,
        t.openPrice.toFixed(d),
        t.closePrice.toFixed(d),
        t.pips.toFixed(1),
        t.profit.toFixed(2),
        t.reason,
        t.strategyRationale || '',
      ].map((value) => `"${String(value).replaceAll('"', '""')}"`);
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `nifty_daily_report_${activeDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="daily-report-title"
      className="fixed inset-0 z-[170] flex justify-end bg-black/60 backdrop-blur-xs text-xs select-none"
    >
      <div className="w-full max-w-3xl h-full ws-surface border-l shadow-2xl flex flex-col overflow-hidden">
        {/* Minimalist Header */}
        <header className="px-5 py-3.5 ws-subtle border-b flex items-center justify-between gap-3 flex-wrap shrink-0">
          <div className="flex items-center gap-2.5">
            <FileText className="w-4 h-4 text-emerald-500 shrink-0" />
            <div>
              <h2 id="daily-report-title" className="font-extrabold text-sm text-slate-900 dark:text-white tracking-tight">
                Daily Performance Report
              </h2>
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                {accountLabel}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => shiftDate(-1)}
              aria-label="Previous day"
              className="p-1.5 rounded-lg border border-slate-300 dark:border-[#2b3b59] bg-white dark:bg-[#0b111d] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1e2d48] cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-[#2b3b59] bg-white dark:bg-[#0b111d]">
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="date"
                value={activeDate}
                onChange={(e) => e.target.value && setActiveDate(e.target.value)}
                className="bg-transparent font-mono text-xs font-bold text-slate-900 dark:text-white outline-none cursor-pointer"
              />
            </div>
            <button
              type="button"
              onClick={() => shiftDate(1)}
              aria-label="Next day"
              className="p-1.5 rounded-lg border border-slate-300 dark:border-[#2b3b59] bg-white dark:bg-[#0b111d] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1e2d48] cursor-pointer"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="ml-1 p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#1e2d48] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Net P&L Hero Strip */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-[#2b3b59] bg-slate-50/70 dark:bg-[#141f35] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold block tracking-wider">
                Realized Net P&amp;L ({activeDate})
              </span>
              <div className="flex items-baseline gap-2.5 mt-0.5">
                <span
                  className={`text-2xl font-black font-mono tabular-nums tracking-tight ${
                    stats.netPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {stats.netPnl >= 0 ? '+' : ''}${stats.netPnl.toFixed(2)}
                </span>
                <span
                  className={`text-xs font-mono font-bold ${
                    stats.netPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  ({stats.netPnl >= 0 ? '+' : ''}{stats.returnPct}%)
                </span>
              </div>
            </div>

            <div className="flex items-center gap-4 sm:text-right border-t sm:border-t-0 border-slate-200 dark:border-[#2b3b59] pt-2.5 sm:pt-0 font-mono">
              <div>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase block font-sans font-bold">
                  Balance
                </span>
                <span className="text-sm font-extrabold text-slate-900 dark:text-white tabular-nums">
                  ${ticker.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="w-px h-8 bg-slate-200 dark:bg-[#2b3b59]" />
              <div>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase block font-sans font-bold">
                  Daily Drawdown
                </span>
                <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {tradingEngine.account.daily_drawdown_pct}% / {tradingEngine.account.max_daily_loss_pct}%
                </span>
              </div>
            </div>
          </div>

          {/* 6 KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            <div className="p-3 rounded-xl border border-slate-200 dark:border-[#2b3b59] bg-white dark:bg-[#141f35]">
              <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block">Win Rate</span>
              <div className="text-base font-extrabold font-mono text-slate-900 dark:text-white tabular-nums mt-0.5">
                {stats.winRate}%
              </div>
              <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                {stats.winCount}W · {stats.lossCount}L ({stats.totalCount} total)
              </div>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 dark:border-[#2b3b59] bg-white dark:bg-[#141f35]">
              <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block">Profit Factor</span>
              <div className="text-base font-extrabold font-mono text-slate-900 dark:text-white tabular-nums mt-0.5">
                {stats.profitFactor}
              </div>
              <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                +${stats.grossProfit} / -${stats.grossLoss}
              </div>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 dark:border-[#2b3b59] bg-white dark:bg-[#141f35]">
              <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block">Pips &amp; Volume</span>
              <div className="text-base font-extrabold font-mono text-slate-900 dark:text-white tabular-nums mt-0.5">
                {stats.totalPips} pips
              </div>
              <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                {stats.totalVolume} lots
              </div>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 dark:border-[#2b3b59] bg-white dark:bg-[#141f35]">
              <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block">Avg Win / Loss</span>
              <div className="text-sm font-extrabold font-mono text-slate-900 dark:text-white tabular-nums mt-0.5">
                +${stats.avgWin} / -${stats.avgLoss}
              </div>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 dark:border-[#2b3b59] bg-white dark:bg-[#141f35]">
              <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block">Long (BUY)</span>
              <div className="text-sm font-extrabold font-mono text-emerald-600 dark:text-emerald-400 tabular-nums mt-0.5">
                {stats.longWinRate}% Win
              </div>
              <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                {stats.longCount} trades
              </div>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 dark:border-[#2b3b59] bg-white dark:bg-[#141f35]">
              <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block">Short (SELL)</span>
              <div className="text-sm font-extrabold font-mono text-rose-600 dark:text-rose-400 tabular-nums mt-0.5">
                {stats.shortWinRate}% Win
              </div>
              <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                {stats.shortCount} trades
              </div>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              {(
                [
                  { id: 'ALL', label: `All (${stats.totalCount})` },
                  { id: 'WIN', label: `Wins (${stats.winCount})` },
                  { id: 'LOSS', label: `Losses (${stats.lossCount})` },
                ] as const
              ).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setOutcomeFilter(o.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                    outcomeFilter === o.id
                      ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950'
                      : 'bg-slate-100 dark:bg-[#141f35] text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {o.label}
                </button>
              ))}

              <span className="text-slate-300 dark:text-slate-700 mx-1">|</span>

              {(['ALL', 'BUY', 'SELL'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDirectionFilter(d)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                    directionFilter === d
                      ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950'
                      : 'bg-slate-100 dark:bg-[#141f35] text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {d === 'ALL' ? 'Both' : d}
                </button>
              ))}
            </div>

            <div className="relative min-w-[180px]">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search symbol or ticket..."
                className="w-full pl-8 pr-3 py-1 rounded-lg border border-slate-300 dark:border-[#2b3b59] bg-slate-50 dark:bg-[#0d1424] text-slate-900 dark:text-white placeholder:text-slate-500 text-xs outline-none focus:border-sky-500"
              />
            </div>
          </div>

          {/* Session Trades Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-xs text-slate-900 dark:text-white uppercase tracking-wider">
                Session Trades ({filteredTrades.length} of {stats.dayTrades.length})
              </h3>
              {stats.dayTrades.length > 0 && (
                <button
                  type="button"
                  onClick={handleDownloadCSV}
                  className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline font-bold cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export CSV</span>
                </button>
              )}
            </div>

            {filteredTrades.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-[#2b3b59]">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-[#0d1424] border-b border-slate-200 dark:border-[#2b3b59] text-[10px] text-slate-500 dark:text-slate-400 uppercase">
                      <th className="py-2.5 px-3">Ticket / Time</th>
                      <th className="py-2.5 px-2">Pair</th>
                      <th className="py-2.5 px-2">Side &amp; Vol</th>
                      <th className="py-2.5 px-2">Prices</th>
                      <th className="py-2.5 px-2">Note / Rationale</th>
                      <th className="py-2.5 px-2">Reason</th>
                      <th className="py-2.5 px-3 text-right">Profit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-[#23314c]">
                    {filteredTrades.map((t, idx) => {
                      const sym = (t.symbol || 'XAUUSD') as SupportedSymbol;
                      const d = getInstrumentConfig(sym).digits;
                      return (
                        <tr key={`${t.ticket}_${t.closeTime}_${idx}`} className="hover:bg-slate-50 dark:hover:bg-[#172238]/60">
                          <td className="py-2.5 px-3 font-mono">
                            <span className="font-bold text-slate-900 dark:text-slate-100 block">#{t.ticket}</span>
                            <span className="text-[10px] text-slate-400">{t.closeTime || '—'}</span>
                          </td>
                          <td className="py-2.5 px-2 font-bold text-slate-800 dark:text-slate-200">{t.symbol || '—'}</td>
                          <td className="py-2.5 px-2 font-mono">
                            <span className={`font-bold ${t.type === 'BUY' ? 'text-emerald-500' : 'text-rose-500'}`}>
                              {t.type}
                            </span>{' '}
                            <span className="text-slate-500 dark:text-slate-400">{t.volume}L</span>
                          </td>
                          <td className="py-2.5 px-2 font-mono text-slate-700 dark:text-slate-300 tabular-nums">
                            {t.openPrice.toFixed(d)} → {t.closePrice.toFixed(d)}
                          </td>
                          <td className="py-2.5 px-2 max-w-[180px] truncate text-slate-600 dark:text-slate-300" title={t.strategyRationale || t.comment || ''}>
                            {t.strategyRationale || t.comment || '—'}
                          </td>
                          <td className="py-2.5 px-2 text-slate-500 dark:text-slate-400">{t.reason}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-extrabold tabular-nums">
                            <span className={t.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                              {t.profit >= 0 ? '+' : ''}${t.profit.toFixed(2)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-10 px-4 rounded-xl border border-dashed border-slate-300 dark:border-[#2b3b59] text-center space-y-1">
                <span className="font-bold text-xs uppercase tracking-wider block text-slate-500 dark:text-slate-400">
                  No Closed Trades for {activeDate}
                </span>
                <span className="text-[11px] text-slate-400 block">
                  Select another date or sync your MetaTrader 5 account history.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <footer className="px-5 py-3.5 ws-subtle border-t flex items-center justify-between gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-[#2b3b59] bg-white dark:bg-[#0b111d] hover:bg-slate-100 dark:hover:bg-[#1e2d48] cursor-pointer"
          >
            Close
          </button>

          <button
            type="button"
            onClick={handleCopyReport}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-950 font-bold cursor-pointer text-xs"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy Summary'}</span>
          </button>
        </footer>
      </div>
    </div>
  );
};
