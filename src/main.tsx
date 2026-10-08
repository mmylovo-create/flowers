import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import './styles/app.css';
import { InternationalizationProvider } from '@astryxdesign/core/i18n';
import ruRU from '@astryxdesign/core/locales/ru-RU.generated.js';
import App from './App';

// Preview builds (a single hosted page) navigate with #/s/<shop>/… and skip the service worker.
const PREVIEW = import.meta.env.VITE_PREVIEW === '1';
const Router = PREVIEW ? HashRouter : BrowserRouter;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, networkMode: 'offlineFirst' },
    mutations: { retry: 0, networkMode: 'always' },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <InternationalizationProvider locale="ru-RU" messages={{ 'ru-RU': ruRU }}>
        <Router>
          <App />
        </Router>
      </InternationalizationProvider>
    </QueryClientProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD && !PREVIEW) {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}
