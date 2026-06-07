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
    console.log('📡 [Supabase] Проверка связи с таблицей vpn_servers...');
    const { data, error } = await supabase.from('vpn_servers').select('*');
    
    if (error) {
      console.error('❌ [Supabase] Ошибка связи:', error.message);
      return false;
    }
    
    console.log(`✅ [Supabase] База данных доступна. Найдено записей: ${data?.length || 0}`);
    if (data && data.length > 0) {
      const s = data[0];
      console.log('📊 [Supabase] Доступные поля в vpn_servers:', Object.keys(s).join(', '));
      data.forEach(srv => {
        // Пытаемся определить адрес сервера из разных возможных полей
        const address = srv.host || srv.ip_address || srv.domain || srv.ip || 'НЕИЗВЕСТНО';
        console.log(`   📍 Сервер: ${srv.name} (${address}) - ${srv.is_active ? 'Активен' : 'Выключен'}`);
      });
    }
    return true;
  } catch (err: any) {
    console.error('❌ [Supabase] Ошибка подключения:', err.message || err);
    return false;
  }
}
