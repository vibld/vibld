import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ClerkRoot } from './auth/clerk.tsx';
import { installRateLimitRetry } from './net/rate-limit-retry.ts';
import {
  captureReferral,
  referralStorage,
} from './referral/referral-client.ts';
import {
  briefStorage,
  captureTemplateBrief,
} from './templates/template-brief.ts';
import './styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container is missing from index.html');
}

// Before any client calls the API: a burst the edge rate limit refuses is
// waited out rather than shown as an error (D68).
installRateLimitRetry(globalThis);

// Before anything renders: Clerk's sign-up form carries its own steps in the
// path, so the `?ref=` a shared link arrived with is only certain to be in
// the URL on this first load.
captureReferral(window.location, referralStorage());
// The same, for a brief vibld.com sent with "Start from this template".
captureTemplateBrief(window.location, window.history, briefStorage());

createRoot(container).render(
  <StrictMode>
    <ClerkRoot>
      <App />
    </ClerkRoot>
  </StrictMode>,
);
