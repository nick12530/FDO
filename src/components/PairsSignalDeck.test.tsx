import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PairsSignalDeck } from './PairsSignalDeck';
import { tradingEngine } from '../engine/tradingEngine';
import { SUPPORTED_SYMBOLS } from '../engine/instrumentConfig';

describe('PairsSignalDeck', () => {
  it('shows all supported pairs as unscanned when no fresh analyses exist', () => {
    tradingEngine.stopEngineLoops();

    render(
      <PairsSignalDeck
        scannerAnalyses={[]}
        activeSymbol="XAUUSD"
        onSelectSymbol={() => {}}
      />
    );

    expect(screen.getByText('Waiting for live quotes and broker candles...')).toBeTruthy();
    expect(screen.queryByText(new RegExp(`${SUPPORTED_SYMBOLS.length} PAIRS`))).toBeNull();
  });
});
