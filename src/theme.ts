import { create } from 'zustand';

export type Theme = 'dark' | 'light';

const THEME_STORAGE_KEY = 'oneflow-theme';

function loadInitialTheme(): Theme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
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
