import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

// Значения подтягиваются из process.env (после вызова dotenv.config() в index.ts)
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY || ''; 

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('⚠️ [Supabase] ОШИБКА: URL или Ключ не найдены в окружении!');
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  },
  // Указываем транспорт для WebSocket (Fix WebSocket Error в Node 20)
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
    console.log('✅ [Supabase] Соединение установлено успешно.');
    return true;
  } catch (err: any) {
    console.error('❌ [Supabase] Непредвиденная ошибка:', err.message || err);
    return false;
  }
}
