import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import WebAuthGate from './components/WebAuthGate';
import { installMockApiIfNeeded } from './mockApi';
import { installWebApi } from './webApi';
import ConsentBanner from './components/ConsentBanner';
import { initAnalytics } from './analytics';
import { useThemeStore } from './theme';
import { useLanguageStore } from './i18n';
// Self-hosted (not Google Fonts CDN) so the desktop build works fully offline — includes the
// cyrillic subset since the app's primary audience is Russian-speaking.
import '@fontsource-variable/geist';
// Inter stays loaded only for Motion Engine: its storyboard/video renderer (src/motion/render.ts)
// draws captions with it, so changing the UI font must not change rendered videos.
import '@fontsource-variable/inter/wght.css';
import './index.css';

const isWebMode = import.meta.env.VITE_WEB_MODE === '1';

// The theme goes on <html> before the first render, so the login screen and its windows (terms,
// password reset) already use it; App keeps it in sync after that.
document.documentElement.dataset.theme = useThemeStore.getState().theme;
// <html lang> follows the interface language (English unless the user picked Russian).
document.documentElement.lang = useLanguageStore.getState().language;
useLanguageStore.subscribe((s) => {
  document.documentElement.lang = s.language;
});

if (isWebMode) {
  installWebApi();
  // Starts in memory-only mode unless consent was already given — see analytics.ts.
  initAnalytics();
} else {
  installMockApiIfNeeded();
}

const content = isWebMode ? (
  <>
    <WebAuthGate>
      <App />
    </WebAuthGate>
    <ConsentBanner />
  </>
) : (
  <App />
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>{content}</ErrorBoundary>
  </StrictMode>
);
