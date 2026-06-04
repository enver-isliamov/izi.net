import axios from 'axios';
import https from 'https';
import http from 'http';

// Global agents to reuse sockets and prevent listener leaks
export const sharedHttpsAgent = new https.Agent({ 
  rejectUnauthorized: false,
  keepAlive: true,
  maxSockets: 50,
  checkServerIdentity: () => undefined // Ignore hostname/cert mismatch (future date fix)
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
  const timeout = customTimeout || 7000; // Increased default timeout to 7s
  return {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      ...headers
    },
    httpsAgent: isHttps ? sharedHttpsAgent : undefined,
    httpAgent: !isHttps ? sharedHttpAgent : undefined,
    timeout: timeout
  };
}
