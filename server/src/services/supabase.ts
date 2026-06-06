import { createClient } from '@supabase/supabase-js';

// Docker внедряет переменные напрямую в process.env, чтение .env здесь не требуется
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY || ''; 

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('⚠️ [Supabase] Учетные данные отсутствуют в process.env!');
} else {
  console.log('📡 [Supabase] Конфигурация найдена, подключаюсь к:', supabaseUrl);
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  }
});

export async function checkDatabase() {
  try {
    const { count, error } = await supabase.from('vpn_servers').select('*', { count: 'exact', head: true });
    if (error) {
      console.error('❌ [Supabase] Ошибка подключения:', error.message);
      return false;
    }
    console.log('✅ [Supabase] База данных подключена. Серверов в таблице:', count || 0);
    return true;
  } catch (err) {
    console.error('❌ [Supabase] Непредвиденная ошибка подключения:', err);
    return false;
  }
}
