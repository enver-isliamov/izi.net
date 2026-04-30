import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''; // fallback
const supabase = createClient(supabaseUrl, supabaseKey);
async function check() {
  const { data: subs, error: err1 } = await supabase.from('subscriptions').select('id, user_id, status, expires_at');
  const { data: users, error: err2 } = await supabase.from('users').select('id, email');
  const { data: servers, error: err3 } = await supabase.from('vpn_servers').select('*');
  
  console.log("SUBSCRIPTIONS:", subs);
  console.log("USERS:", users);
  console.log("SERVERS:", servers);
}
check();
