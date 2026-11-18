/**
 * SafetyFeatures.test.tsx - Component tests proving:
 * (a) Kill-switch banner appears when engine state arms
 * (b) Execution remains disabled until a validated broker-backed signal exists.
 */

import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { KillSwitchBanner } from './KillSwitchBanner';
import { SignalEngineCard } from './SignalEngineCard';
import { tradingEngine, MAX_SPREAD_POINTS } from '../engine/tradingEngine';

describe('Trading Safety UX Components', () => {
  beforeEach(() => {
    tradingEngine.stopEngineLoops();
    (tradingEngine as any).connected = false;
    tradingEngine.mt5Account.connected = false;
    (tradingEngine as any).hasBrokerMarketData = false;
    (tradingEngine as any).lastBrokerQuoteAt = 0;
    if (tradingEngine.killSwitch) {
      tradingEngine.toggleKillSwitch();
    }
    tradingEngine.spread = 18; // normal spread
    (tradingEngine as any).invalidateTicker();
    (tradingEngine as any).emit('ticker');
  });

  it('proves KillSwitchBanner appears when engine state arms', () => {
    const { rerender } = render(<KillSwitchBanner />);

    // Initially disarmed, banner should not be in document
    expect(screen.queryByRole('alert')).toBeNull();

    // Arm kill switch
    act(() => {
      tradingEngine.toggleKillSwitch();
    });

    rerender(<KillSwitchBanner />);

    // Banner must now appear with alert role
    const alert = screen.getByRole('alert');
    expect(alert).toBeDefined();
    expect(alert.textContent).toContain('KILL SWITCH ARMED');
  });

  it('blocks orders without a validated signal and reports wide spreads', () => {
    (tradingEngine as any).connected = true;
    tradingEngine.mt5Account.connected = true;
    (tradingEngine as any).hasBrokerMarketData = true;
    (tradingEngine as any).lastBrokerQuoteAt = Date.now();
    const { rerender } = render(<SignalEngineCard onExecuteSignal={() => {}} />);

    let button = screen.getByRole('button', { name: /WAITING FOR CONFIRMED SETUP/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    // Widen spread above MAX_SPREAD_POINTS
    act(() => {
      tradingEngine.spread = 45;
      (tradingEngine as any).invalidateTicker();
      (tradingEngine as any).emit('ticker');
    });

    rerender(<SignalEngineCard onExecuteSignal={() => {}} />);

    button = screen.getByRole('button', { name: /WAITING FOR CONFIRMED SETUP/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/45 PTS/)).toBeDefined();
    expect(MAX_SPREAD_POINTS).toBe(40);
  });

  it('labels broker spread unavailable instead of displaying a zero placeholder', () => {
    render(<SignalEngineCard onExecuteSignal={() => {}} />);

    expect(screen.getByText('Spread unavailable')).toBeDefined();
    expect(screen.queryByText('0 PTS')).toBeNull();
    expect(screen.getByRole('button', { name: /WAITING FOR MT5 QUOTE/i })).toBeDefined();
  });
});
