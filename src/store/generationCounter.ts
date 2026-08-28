import { create } from 'zustand';

interface GenerationCounterState {
  count: number;
  increment: () => void;
}

export const useGenerationCounter = create<GenerationCounterState>((set) => ({
  count: 0,
  increment: () => set((s) => ({ count: s.count + 1 })),
}));
