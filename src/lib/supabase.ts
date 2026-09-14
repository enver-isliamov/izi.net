import { createClient } from '@supabase/supabase-js';

function sanitizeUrl(url?: string): string {
  if (!url || typeof url !== 'string') return 'https://placeholder.supabase.co';
  const trimmed = url.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return 'https://placeholder.supabase.co';
  }
  return trimmed;
}

function sanitizeKey(key?: string): string {
  if (!key || typeof key !== 'string') return 'placeholder-anon-key';
  const trimmed = key.trim();
  if (trimmed.startsWith('#') || trimmed.length < 5) return 'placeholder-anon-key';
  return trimmed;
}

const supabaseUrl = sanitizeUrl(import.meta.env.VITE_SUPABASE_URL);
const supabaseAnonKey = sanitizeKey(import.meta.env.VITE_SUPABASE_ANON_KEY);

const PROXY_PATHS = ['/rest/v1/', '/auth/v1/'];

let supabaseHost = '';
try {
  if (supabaseUrl) supabaseHost = new URL(supabaseUrl).hostname;
} catch {}

function proxyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  if (supabaseHost && url.includes(supabaseHost)) {
    try {
      const parsed = new URL(url);
      const relativePath = parsed.pathname + parsed.search;
      if (PROXY_PATHS.some(p => relativePath.startsWith(p))) {
        const proxyUrl = '/api/supabase-proxy' + relativePath;
        const method = init?.method || 'GET';
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (init?.headers) {
          const src = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : init.headers as Record<string, string>;
          Object.assign(headers, src);
        }
        return fetch(proxyUrl, { ...init, headers });
      }
    } catch {}
  }

  return fetch(input, init);
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'izinet-auth'
  },
  global: { fetch: proxyFetch }
});
