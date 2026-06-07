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
    console.log('📡 [Supabase] Проверка соответствия схеме из Supabase.md...');
    
    // Проверка таблицы users (а не profiles!)
    const { data: users, error: uErr } = await supabase.from('users').select('*').limit(1);
    if (uErr) {
      console.error('❌ [Supabase] Таблица public.users не найдена или недоступна:', uErr.message);
    } else {
      console.log('✅ [Supabase] Таблица public.users активна.');
    }

    // Проверка таблицы settings
    const { data: settings, error: sErr } = await supabase.from('settings').select('*').limit(1);
    if (sErr) {
      console.error('❌ [Supabase] Таблица public.settings не найдена:', sErr.message);
    } else {
      console.log('✅ [Supabase] Таблица public.settings активна.');
    }

    const { data: servers, error: srvErr } = await supabase.from('vpn_servers').select('*');
    if (srvErr) {
      console.error('❌ [Supabase] Ошибка таблицы vpn_servers:', srvErr.message);
      return false;
    }
    
    console.log(`✅ [Supabase] Найдено серверов в БД: ${servers?.length || 0}`);
    servers?.forEach(srv => {
      console.log(`   📍 Сервер: ${srv.name} (IP: ${srv.ip}, Domain: ${srv.domain}) - ${srv.is_active ? 'Активен' : 'Выключен'}`);
    });

    return true;
  } catch (err: any) {
    console.error('❌ [Supabase] Критическая ошибка диагностики:', err.message || err);
    return false;
  }
}
