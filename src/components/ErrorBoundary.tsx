import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLanguageStore, ru, en } from '../i18n';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// Without this, any single uncaught render error (e.g. malformed node data injected by the
// AI assistant's node-chain feature) unmounts the entire app, leaving a blank window.
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Render error caught by ErrorBoundary:', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      // Class component — can't use the useT() hook, so this reads the store directly.
      const t = useLanguageStore.getState().language === 'en' ? en : ru;
      return (
        <div className="crash-screen">
          <h2>{t.errorBoundary.title}</h2>
          <p>{t.errorBoundary.text}</p>
          <pre className="crash-message">{this.state.error.message}</pre>
          <button className="generate-btn" onClick={this.handleReload}>
            {t.errorBoundary.reload}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
