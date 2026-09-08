import { create } from 'zustand';

export type Theme = 'dark' | 'light';

const THEME_STORAGE_KEY = 'oneflow-theme';

// Re-enabled (see the theme row next to language in ProfileModal.tsx) with a saved choice
// taking priority; new sessions default to dark, since that's the theme this app is built
// around (see the App.css :root comment — light is the explicit override, not the base).
function loadInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // Private-browsing/quota edge case — falls through to the default below.
  }
  return 'dark';
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
