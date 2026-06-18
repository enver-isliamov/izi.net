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

// Глобальный перехват ошибок — сохраняем в localStorage чтобы не терять при перезагрузке
window.addEventListener('error', (event) => {
  const msg = `[${new Date().toISOString()}] ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`;
  const errors = JSON.parse(localStorage.getItem('izinet_errors') || '[]');
  errors.push(msg);
  if (errors.length > 50) errors.shift();
  localStorage.setItem('izinet_errors', JSON.stringify(errors));
});

window.addEventListener('unhandledrejection', (event) => {
  const msg = `[${new Date().toISOString()}] Unhandled: ${event.reason}`;
  const errors = JSON.parse(localStorage.getItem('izinet_errors') || '[]');
  errors.push(msg);
  if (errors.length > 50) errors.shift();
  localStorage.setItem('izinet_errors', JSON.stringify(errors));
});

// Показать сохранённые ошибки в консоли
const savedErrors = JSON.parse(localStorage.getItem('izinet_errors') || '[]');
if (savedErrors.length > 0) {
  console.group('📋 Сохранённые ошибки (из прошлых загрузок):');
  savedErrors.forEach((e: string) => console.error(e));
  console.groupEnd();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
