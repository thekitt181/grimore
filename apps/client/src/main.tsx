import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ClerkProvider } from '@clerk/clerk-react';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { QueryDevtoolsGate } from './components/QueryDevtoolsGate';
import { queryClient } from './lib/queryClient';
import './styles/globals.css';

const PUBLISHABLE_KEY = import.meta.env['VITE_CLERK_PUBLISHABLE_KEY'] as string;

if (!PUBLISHABLE_KEY) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <App />
          <QueryDevtoolsGate />
        </BrowserRouter>
      </QueryClientProvider>
    </ClerkProvider>
  </React.StrictMode>
);
