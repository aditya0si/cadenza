import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthRoot, resolveAuthMode } from './auth/AuthProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root container #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthRoot mode={resolveAuthMode()}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthRoot>
    </ErrorBoundary>
  </StrictMode>,
);
