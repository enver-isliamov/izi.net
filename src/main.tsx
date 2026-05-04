import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import axios from 'axios';
import App from './App.tsx';
import './index.css';

const envUrl = import.meta.env.VITE_API_URL;
// Use current host if VITE_API_URL is missing or just a relative path
// This ensures that if front and back are on the same server, they always communicate correctly
const apiUrl = (envUrl && envUrl.startsWith('http')) ? envUrl.replace(/\/$/, '') : window.location.origin;

axios.defaults.baseURL = apiUrl;
console.log('🚀 API Base URL set to:', axios.defaults.baseURL);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
