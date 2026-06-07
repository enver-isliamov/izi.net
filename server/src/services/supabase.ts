import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || ''; 
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY || ''; 

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ [Supabase] ОШИБКА: URL или SERVICE_ROLE_KEY не найдены!');
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  },
  global: {
    // @ts-ignore
    headers: { 'x-client-info': 'izinet-app' }
  },
  realtime: {
    // @ts-ignore
    transport: WebSocket
  }
});

export async function checkDatabase() {
  try {
    const { data, error } = await supabase.from('vpn_servers').select('id').limit(1);
    if (error) {
      console.error('❌ [Supabase] Ошибка связи:', error.message);
      return false;
    }
    console.log('✅ [Supabase] Соединение установлено.');
    return true;
  } catch (err: any) {
    console.error('❌ [Supabase] Непредвиденная ошибка:', err.message || err);
    return false;
  }
}
