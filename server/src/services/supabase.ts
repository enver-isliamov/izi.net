import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || ''; 
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY || ''; 

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  global: { headers: { 'x-client-info': 'izinet-app' } },
  realtime: { transport: WebSocket }
});

export async function checkDatabase() {
  try {
    console.log('📡 [Supabase] Глубокая диагностика таблиц...');
    
    // Проверка всех ключевых таблиц из обеих схем
    const tables = ['users', 'settings', 'vpn_servers', 'balances', 'subscriptions', 'transactions', 'payments'];
    for (const table of tables) {
      const { error } = await supabase.from(table).select('count', { count: 'exact', head: true }).limit(1);
      if (error) console.error(`❌ [Supabase] Таблица ${table}:`, error.message);
      else console.log(`✅ [Supabase] Таблица ${table} активна.`);
    }

    const { data: servers } = await supabase.from('vpn_servers').select('*');
    console.log(`✅ [Supabase] Найдено серверов: ${servers?.length || 0}`);
    servers?.forEach(srv => {
      const address = srv.ip || srv.domain || srv.host || '???';
      console.log(`   📍 [DB] ${srv.name}: ${address} (Active: ${srv.is_active})`);
    });

    return true;
  } catch (err: any) {
    console.error('❌ [Supabase] Сбой диагностики:', err.message);
    return false;
  }
}
