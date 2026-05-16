import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import axios from 'axios';
import App from './App.tsx';
import './index.css';

const envUrl = import.meta.env.VITE_API_URL;
const isVercel = window.location.hostname.includes('vercel.app');

// ВАЖНО: При запуске на продакшен доменах (включая Vercel и izinet.online) всегда используем относительные пути.
// Это предотвращает ошибку Mixed Content (HTTPS -> HTTP) и проблемы с CORS.
const isProdDomain = window.location.hostname.includes('vercel.app') || window.location.hostname.includes('izinet.online');
const apiUrl = (!isProdDomain && envUrl && envUrl.startsWith('http')) ? envUrl.replace(/\/$/, '') : '';

axios.defaults.baseURL = apiUrl;
console.log('🚀 API Config:', {
  hostname: window.location.hostname,
  isProdDomain,
  envUrl,
  detectedBaseURL: axios.defaults.baseURL || '(relative)'
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
