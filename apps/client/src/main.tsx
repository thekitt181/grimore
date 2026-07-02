import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { QueryDevtoolsGate } from './components/QueryDevtoolsGate';
import { queryClient } from './lib/queryClient';
import './styles/globals.css';

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            background: '#0a0a0f',
            color: '#ffb4b4',
            fontFamily: 'system-ui, sans-serif',
            textAlign: 'center',
          }}
        >
          <div>
            <p>Grimoire failed to start.</p>
            <p style={{ color: '#8a8075', marginTop: '0.75rem' }}>{this.state.error.message}</p>
            <p style={{ marginTop: '1rem' }}>
              <a
                href="/sign-in"
                style={{ color: '#c9a84c' }}
                onClick={() => {
                  window.location.href = '/sign-in';
                }}
              >
                Open sign-in
              </a>
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootEl = document.getElementById('root');
if (rootEl) rootEl.dataset.appMounted = '1';

ReactDOM.createRoot(rootEl!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <App />
          <QueryDevtoolsGate />
        </BrowserRouter>
      </QueryClientProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);
