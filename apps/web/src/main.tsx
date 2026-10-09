import React from 'react';
import { createRoot } from 'react-dom/client';
import './i18n/index.js';
import './styles/app.css';
import { App } from './App.js';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
