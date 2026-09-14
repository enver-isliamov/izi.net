import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

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

const rawUrl = process.env.VITE_SUPABASE_URL;
const rawAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const rawServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY;

const supabaseUrl = sanitizeUrl(rawUrl);
const supabaseAnonKey = sanitizeKey(rawAnonKey); 
const supabaseServiceKey = sanitizeKey(rawServiceKey || supabaseAnonKey); 

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  global: { headers: { 'x-client-info': 'izinet-app' } },
  realtime: { transport: WebSocket as any }
});

export async function checkDatabase() {
  try {
    if (!rawUrl || rawUrl.includes('placeholder') || rawUrl.startsWith('#') || !rawUrl.startsWith('http')) {
      console.log('ℹ️ [Supabase] VITE_SUPABASE_URL is not configured - skipping DB check.');
      return false;
    }

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
