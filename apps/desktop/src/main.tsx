import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { enableMapSet } from 'immer';
import { App } from './app';
import './app.css';
// @ts-ignore xterm CSS has no type declarations
import '@xterm/xterm/css/xterm.css';
import 'katex/dist/katex.min.css';

enableMapSet();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
window.__hyscodeBoot?.ready();
