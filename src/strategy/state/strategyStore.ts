import { create } from 'zustand';
import type { StrategyHistoryEvent, StrategyV4 } from '../domain/types';
import { genId } from '../domain/ids';
import { type StrategyModule, markStale as markStaleGraph } from '../domain/dependencyGraph';

interface StrategyStoreState {
  strategy: StrategyV4 | null;
  setStrategy: (strategy: StrategyV4) => void;
  updateStrategy: (updater: (strategy: StrategyV4) => StrategyV4) => void;
  markStale: (changedModule: StrategyModule) => void;
  pushHistory: (event: Omit<StrategyHistoryEvent, 'id' | 'timestamp'>) => void;
  reset: () => void;
}

/** Holds the live StrategyV4 for the session (spec: not yet persisted server-side — same as the pre-v4 module). */
export const useStrategyStore = create<StrategyStoreState>((set) => ({
  strategy: null,
  setStrategy: (strategy) => set({ strategy }),
  updateStrategy: (updater) =>
    set((state) => (state.strategy ? { strategy: { ...updater(state.strategy), updatedAt: Date.now() } } : state)),
  markStale: (changedModule) =>
    set((state) => (state.strategy ? { strategy: markStaleGraph(state.strategy, changedModule) } : state)),
  pushHistory: (event) =>
    set((state) => {
      if (!state.strategy) return state;
      const full: StrategyHistoryEvent = { id: genId('hist'), timestamp: Date.now(), ...event };
      return { strategy: { ...state.strategy, history: [...state.strategy.history, full], updatedAt: Date.now() } };
    }),
  reset: () => set({ strategy: null }),
}));
