import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

async function fix() {
  const { data: subs } = await supabase.from('subscriptions').select('id, v2ray_config').like('v2ray_config', '%pbk=undefined%');
  if (!subs || subs.length === 0) return console.log("No broken configs found.");
  
  for (const sub of subs) {
    const newConfig = sub.v2ray_config.replace('pbk=undefined', 'pbk=J6aASk2iHjNDXP1Dv4fDit4PFqzE8vJm1QAwWSukDjA');
    await supabase.from('subscriptions').update({ v2ray_config: newConfig }).eq('id', sub.id);
    console.log("Fixed sub:", sub.id);
  }
}
fix();
