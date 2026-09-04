import { create } from 'zustand';

export type Theme = 'dark' | 'light';

const THEME_STORAGE_KEY = 'oneflow-theme';

// Dark theme is disabled for now (light-only) — see the removed toggle in ProfileModal.tsx.
// Kept as a one-line change to re-enable rather than ripping out the dark CSS/store plumbing.
function loadInitialTheme(): Theme {
  return 'light';
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: loadInitialTheme(),
  setTheme: (theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Private-browsing/quota edge case — theme just won't survive a reload.
    }
    set({ theme });
  },
}));
