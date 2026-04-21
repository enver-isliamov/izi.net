import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase.from('subscriptions').select('id, user_id, v2ray_config').limit(3).order('created_at', { ascending: false });
  if (error) console.error(error);
  console.log("CONFIGS:", data);
}

check();
