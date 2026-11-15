/**
 * WeekendMarketBanner.tsx - Slim Monochromatic Market Schedule Notice
 * Clean single-row hairline ribbon without pill badge clutter.
 */

import React from 'react';
import { useMarketOpenCountdown } from '../engine/marketHours';
import { Clock } from 'lucide-react';

export const WeekendMarketBanner: React.FC = React.memo(() => {
  const schedule = useMarketOpenCountdown();

  if (!schedule || schedule.isOpen) {
    return null;
  }

  return (
    <div className="w-full border-b border-slate-300 dark:border-[#2b3b59] bg-slate-100/90 dark:bg-[#0d1424] px-3 sm:px-5 py-1.5 text-[11px] font-mono text-slate-700 dark:text-slate-200">
      <div className="max-w-[1680px] mx-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="inline-flex items-center gap-1.5 font-semibold text-sky-700 dark:text-sky-400">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span>Interbank Paused</span>
          </span>
          <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
          <span>
            Opens in{' '}
            <strong className="text-slate-900 dark:text-white tabular-nums">
              {schedule.liveCountdownText}
            </strong>
          </span>
          <span className="hidden md:inline text-slate-400 dark:text-slate-500">
            ({schedule.reopenTimeFormatted})
          </span>
        </div>

        <span className="text-slate-500 dark:text-slate-400 hidden sm:inline">
          Signals active only when live broker quotes resume
        </span>
      </div>
    </div>
  );
});
