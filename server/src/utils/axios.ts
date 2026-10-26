import axios from 'axios';
import https from 'https';
import http from 'http';

// Панель 3x-ui часто стоит с self-signed сертификатом или на localhost, поэтому
// небезопасный агент разрешён ТОЛЬКО для запросов к панели (getRequestConfig).
// Платежи, Supabase и Telegram должны проверять сертификат обычным способом.
export const panelHttpsAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
  maxSockets: 50,
  checkServerIdentity: () => undefined // 3x-ui: локальная панель без публичного CA
});

export const sharedHttpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50
});

export const sharedHttpAgent = new http.Agent({ 
  keepAlive: true,
  maxSockets: 50 
});

/**
 * Helper for axios requests to 3x-ui and other services
 */
export function getRequestConfig(url: string, headers: any = {}, customTimeout?: number) {
  const isHttps = url.startsWith('https');
  const timeout = customTimeout || 7000; // Таймаут увеличен до 7с для стабильности (стандарт Production)
  return {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      ...headers
    },
    httpsAgent: isHttps ? panelHttpsAgent : undefined,
    httpAgent: !isHttps ? sharedHttpAgent : undefined,
    timeout: timeout
  };
}
