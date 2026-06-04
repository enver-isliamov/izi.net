import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY || ''; 

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('⚠️ SUPABASE credentials missing in environment variables!');
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  }
});

// Health check for Database
export async function checkDatabase() {
  try {
    const { count, error } = await supabase.from('vpn_servers').select('*', { count: 'exact', head: true });
    if (error) {
      console.error('❌ Database connection error on startup:', error.message);
      return false;
    } else {
      console.log('✅ Database connected successfully. Active servers in table:', count || 0);
      return true;
    }
  } catch (err) {
    console.error('❌ Failed to connect to database:', err);
    return false;
  }
}
