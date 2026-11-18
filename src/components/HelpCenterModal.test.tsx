import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HelpCenterModal } from './HelpCenterModal';

describe('HelpCenterModal', () => {
  it('searches article content and shows the calendar coverage limitation', () => {
    render(
      <HelpCenterModal
        isOpen
        onClose={() => {}}
        onOpenBridge={() => {}}
        initialTab="real_time_news"
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/Search topics/), { target: { value: 'actuals' } });

    expect(screen.getByRole('button', { name: /Live News & Macro Feed/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Live News & Macro Feed/ }));
    expect(screen.getByText(/not an archived actuals database/)).toBeTruthy();
  });

  it('offers a direct action to open the MT5 connection dialog', () => {
    const onOpenBridge = vi.fn();
    const onClose = vi.fn();

    render(
      <HelpCenterModal
        isOpen
        onClose={onClose}
        onOpenBridge={onOpenBridge}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open MT5 Connection' }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(onOpenBridge).toHaveBeenCalledOnce();
  });
});
