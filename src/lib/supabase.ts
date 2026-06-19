import { createClient } from '@supabase/supabase-js';

// Фронтенд обращается к Supabase НАПРЯМУЮ, а не через proxy.
// Это обеспечивает стабильность Auth токенов при перегрузке сервера.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'izinet-auth'
  }
});
