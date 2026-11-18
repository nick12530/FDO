import { useSyncExternalStore } from 'react';
import {
  DEFAULT_INDICATOR_CONFIG,
  type SMCIndicatorConfig,
} from '../types/smc';

export interface ChartIndicatorState {
  showIndicators: boolean;
  config: SMCIndicatorConfig;
}

const STORAGE_KEY = 'nifty_chart_indicators_v1';

function readInitialState(): ChartIndicatorState {
  if (typeof localStorage === 'undefined') {
    return { showIndicators: true, config: DEFAULT_INDICATOR_CONFIG };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { showIndicators: true, config: DEFAULT_INDICATOR_CONFIG };
    const parsed = JSON.parse(raw) as Partial<ChartIndicatorState>;
    return {
      showIndicators: typeof parsed.showIndicators === 'boolean' ? parsed.showIndicators : true,
      config: {
        ...DEFAULT_INDICATOR_CONFIG,
        ...(parsed.config || {}),
      },
    };
  } catch {
    return { showIndicators: true, config: DEFAULT_INDICATOR_CONFIG };
  }
}

let state: ChartIndicatorState = readInitialState();
const listeners = new Set<() => void>();

function persist(next: ChartIndicatorState) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors
  }
}

function updateState(next: ChartIndicatorState) {
  state = next;
  persist(next);
  listeners.forEach((cb) => {
    try {
      cb();
    } catch {
      // Ignore subscriber errors
    }
  });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): ChartIndicatorState {
  return state;
}

export function setShowIndicators(show: boolean): void {
  if (state.showIndicators === show) return;
  updateState({ ...state, showIndicators: show });
}

export function toggleShowIndicators(): void {
  updateState({ ...state, showIndicators: !state.showIndicators });
}

export function toggleIndicatorKey(key: keyof SMCIndicatorConfig): void {
  updateState({
    ...state,
    config: {
      ...state.config,
      [key]: !state.config[key],
    },
  });
}

export function useIndicatorSync(): ChartIndicatorState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
