import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
  const { data: subs, error } = await supabase.from('subscriptions').select('*').limit(5);
  if (error) {
    console.error(error);
  } else if (subs) {
    console.log(`FOUND ${subs.length} SUBSCRIPTIONS:`);
    for (const sub of subs) {
      console.log(`Sub ID: ${sub.id}`);
      console.log(`Telegram ID: ${sub.tg_id}`);
      console.log(`Status: ${sub.status}`);
      console.log(`Expires At: ${sub.expires_at}`);
      console.log(`Server Type: ${sub.server_type}`);
      console.log(`v2ray_config:`, sub.v2ray_config);
      console.log('---');
    }
  }
}

run();
