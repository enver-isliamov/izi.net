import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

// Значения подтягиваются из process.env (после вызова dotenv.config() в index.ts)
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || ''; // Публичный ключ для фронта
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY || ''; 

if (!supabaseUrl) console.error('❌ [Supabase] URL базы данных не найден!');
if (!supabaseAnonKey) console.warn('⚠️ [Supabase] VITE_SUPABASE_ANON_KEY отсутствует (нужен для сайта)');
if (!supabaseServiceKey) console.error('❌ [Supabase] SERVICE_ROLE_KEY отсутствует (нужен для сервера)');

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
      console.error('❌ [Supabase] Ошибка запроса:', error.message);
      return false;
    }
    console.log('✅ [Supabase] База данных доступна.');
    return true;
  } catch (err: any) {
    console.error('❌ [Supabase] Ошибка подключения:', err.message || err);
    return false;
  }
}
