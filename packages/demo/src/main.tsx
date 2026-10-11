import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './style.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing application root.');
const root = createRoot(container);
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Full module replacement also tears down workers and any pending capture.
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
