import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ClerkRoot } from './auth/clerk.tsx';
import './styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <ClerkRoot>
      <App />
    </ClerkRoot>
  </StrictMode>,
);
