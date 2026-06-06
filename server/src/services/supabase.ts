import { createClient } from '@supabase/supabase-js';

// Прямая загрузка из окружения Docker
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY || ''; 

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('⚠️ [Supabase] ОШИБКА: Учетные данные не найдены в process.env!');
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
      console.error('❌ [Supabase] Ошибка:', error.message);
      return false;
    }
    console.log('✅ [Supabase] Подключено успешно. Серверов:', count || 0);
    return true;
  } catch (err) {
    console.error('❌ [Supabase] Критический сбой подключения:', err);
    return false;
  }
}
