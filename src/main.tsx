import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import axios from 'axios';
import App from './App.tsx';
import './index.css';

const envUrl = import.meta.env.VITE_API_URL;
// Динамически определяем базу API:
// 1. Если есть VITE_API_URL (полный путь) - используем его.
// 2. Иначе используем текущий хост ( window.location.origin ).
const apiUrl = (envUrl && envUrl.startsWith('http')) 
  ? envUrl.replace(/\/$/, '') 
  : window.location.origin;

axios.defaults.baseURL = apiUrl;
console.log('🚀 API Base URL:', axios.defaults.baseURL);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
