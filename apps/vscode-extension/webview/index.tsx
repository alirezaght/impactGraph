import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './src/app.js';

import './styles.css';

// Webview entry (bundled to dist/webview/webview.js by esbuild and loaded with a CSP nonce).

const container = document.getElementById('impactgraph-root');
if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
