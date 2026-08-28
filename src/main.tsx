import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import WebAuthGate from './components/WebAuthGate';
import { installMockApiIfNeeded } from './mockApi';
import { installWebApi } from './webApi';
// Self-hosted (not Google Fonts CDN) so the desktop build works fully offline — includes the
// cyrillic subset since the app's primary audience is Russian-speaking.
import '@fontsource-variable/inter/wght.css';
import './index.css';

const isWebMode = import.meta.env.VITE_WEB_MODE === '1';

if (isWebMode) {
  installWebApi();
} else {
  installMockApiIfNeeded();
}

const content = isWebMode ? (
  <WebAuthGate>
    <App />
  </WebAuthGate>
) : (
  <App />
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>{content}</ErrorBoundary>
  </StrictMode>
);
