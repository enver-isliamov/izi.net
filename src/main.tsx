import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import axios from 'axios';
import App from './App.tsx';
import './index.css';

const envUrl = import.meta.env.VITE_API_URL;
const isVercel = window.location.hostname.includes('vercel.app');

// ВАЖНО: На Vercel ВСЕГДА используем относительные пути, чтобы работал прокси vercel.json.
// Это предотвращает ошибку Mixed Content (HTTPS -> HTTP).
const apiUrl = (envUrl && envUrl.startsWith('http')) ? envUrl.replace(/\/$/, '') : '';

axios.defaults.baseURL = apiUrl;
console.log('🚀 API Config:', {
  isVercel,
  envUrl,
  detectedBaseURL: axios.defaults.baseURL || '(relative)'
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
