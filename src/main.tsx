import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import axios from 'axios';
import App from './App.tsx';
import './index.css';

const envUrl = import.meta.env.VITE_API_URL;
const isVercel = window.location.hostname.includes('vercel.app');

// ВАЖНО: При запуске на продакшен доменах всегда используем относительные пути.
// Это предотвращает ошибку Mixed Content (HTTPS -> HTTP) и проблемы с CORS через прокси (Cloudflare/Akamai).
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const apiUrl = (!isLocal && envUrl && envUrl.startsWith('http')) ? envUrl.replace(/\/$/, '') : '';

// Если мы на домене (не localhost), принудительно используем относительный путь для безопасности
const finalBaseURL = (!isLocal) ? '' : apiUrl;

axios.defaults.baseURL = finalBaseURL;
console.log('🚀 API Config:', {
  hostname: window.location.hostname,
  isLocal,
  envUrl,
  detectedBaseURL: axios.defaults.baseURL || '(relative)'
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
