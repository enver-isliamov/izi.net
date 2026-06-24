import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const PROXY_PATHS = ['/rest/v1/', '/auth/v1/'];

function proxyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  if (supabaseUrl && url.startsWith(supabaseUrl)) {
    const relativePath = url.slice(supabaseUrl.length + 1);
    if (PROXY_PATHS.some(p => relativePath.startsWith(p))) {
      const proxyUrl = '/api/supabase-proxy/' + relativePath;
      const method = init?.method || 'GET';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (init?.headers) {
        const src = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : init.headers as Record<string, string>;
        Object.assign(headers, src);
      }
      return fetch(proxyUrl, { ...init, headers });
    }
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
