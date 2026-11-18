import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WatchlistRail } from './WatchlistRail';
import { SUPPORTED_SYMBOLS } from '../engine/instrumentConfig';
import { tradingEngine } from '../engine/tradingEngine';

describe('WatchlistRail', () => {
  it('starts with compact symbol rows and expands details on demand', () => {
    tradingEngine.stopEngineLoops();

    render(
      <WatchlistRail
        scannerAnalyses={[]}
        activeSymbol="XAUUSD"
        onSelectSymbol={() => {}}
      />
    );

    expect(screen.getAllByRole('button', { name: /^Expand .* scanner card$/ })).toHaveLength(
      SUPPORTED_SYMBOLS.length
    );
    expect(
      screen.getByRole('button', { name: 'Expand XAUUSD scanner card' }).getAttribute('aria-expanded')
    ).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Expand XAUUSD scanner card' }));

    expect(
      screen.getByRole('button', { name: 'Collapse XAUUSD scanner card' }).getAttribute('aria-expanded')
    ).toBe('true');
  });
});
