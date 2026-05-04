import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import axios from 'axios';
import App from './App.tsx';
import './index.css';

const envUrl = import.meta.env.VITE_API_URL;
const isVercel = window.location.hostname.includes('vercel.app');

// Если мы на Vercel и нет явного VITE_API_URL, используем относительные пути.
// Это заставит запросы идти через прокси vercel.json (HTTPS -> HTTP на бэкенд).
const apiUrl = (envUrl && envUrl.startsWith('http')) 
  ? envUrl.replace(/\/$/, '') 
  : (isVercel ? '' : window.location.origin);

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
