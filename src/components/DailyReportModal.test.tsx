import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DailyReportModal } from './DailyReportModal';

vi.mock('../hooks/useTradingStore', () => ({
  useClosedTrades: () => [],
  useEngine: () => ({ mt5Account: { connected: false } }),
  useTicker: () => ({ balance: 0, equity: 0 }),
}));

vi.mock('../engine/tradingEngine', () => ({
  tradingEngine: {
    account: {
      daily_start_balance: 0,
      daily_drawdown_pct: 0,
      max_daily_loss_pct: 5,
    },
  },
}));

describe('DailyReportModal', () => {
  it('shows unavailable metrics instead of zero-valued performance for an empty sample', () => {
    render(
      <DailyReportModal
        isOpen
        onClose={() => {}}
        selectedDate="2026-01-01"
      />
    );

    expect(screen.getAllByText('No closed trades').length).toBeGreaterThan(0);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('$0.00')).toBeNull();
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
  });
});
