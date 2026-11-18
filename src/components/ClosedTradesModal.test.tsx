import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClosedTradesModal } from './ClosedTradesModal';

const hookData = vi.hoisted(() => ({
  journalTrades: [{
    ticket: 42,
    openTime: '2026-01-01T10:00:00.000Z',
    closeTime: '',
    symbol: 'XAUUSD',
    type: 'BUY' as const,
    volume: 0.01,
    openPrice: 2000,
    closePrice: 2000,
    sl: 1990,
    tp: 2020,
    profit: 0,
    pips: 0,
    reason: 'Manual' as const,
    status: 'RUNNING' as const,
  }],
}));

vi.mock('../hooks/useTradingStore', () => ({
  useClosedTrades: () => [],
  useEngine: () => ({ mt5Account: { connected: true, login: '1001', server: 'Demo' } }),
  useJournalSignals: () => [],
  useJournalTrades: () => hookData.journalTrades,
  usePositions: () => ({ positions: [] }),
  useTicker: () => ({ symbol: 'XAUUSD', bid: 2100, ask: 2100.2 }),
}));

vi.mock('../engine/tradingEngine', () => ({
  tradingEngine: {
    pairData: {},
    closePosition: vi.fn(),
    closeAll: vi.fn(),
  },
}));

vi.mock('../engine/mt5Bridge', () => ({
  mt5Bridge: { refreshAccountHistory: vi.fn() },
}));

describe('ClosedTradesModal', () => {
  it('does not estimate P&L or offer close controls for journal-only running trades', () => {
    render(
      <ClosedTradesModal
        isOpen
        onClose={() => {}}
        defaultTab="trades"
      />
    );

    expect(screen.getByText('Awaiting MT5 confirmation')).toBeTruthy();
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Close position/ })).toBeNull();
  });
});
