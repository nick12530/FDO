import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { CommandBar } from './CommandBar';
import { tradingEngine } from '../engine/tradingEngine';

describe('CommandBar account balances', () => {
  afterEach(() => {
    cleanup();
    act(() => tradingEngine.unlinkMt5Account());
    tradingEngine.stopEngineLoops();
    localStorage.clear();
  });

  it('keeps broker balance and equity visible in the compact account strip', () => {
    tradingEngine.stopEngineLoops();
    act(() => tradingEngine.linkMt5Account('73125', 'Demo-Server', 1250.5, 1244.25));

    render(
      <CommandBar
        isDark={false}
        onToggleTheme={() => {}}
        onOpenModal={() => {}}
        onToggleKillSwitchPrompt={() => {}}
      />
    );

    const balances = screen.getByRole('group', { name: 'Broker account balances' });
    expect(balances.textContent).toContain('#73125');
    expect(balances.textContent).toContain('$1,250.50');
    expect(balances.textContent).toContain('$1,244.25');
  });
});
